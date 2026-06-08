import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Journal {
  entries?: Array<{ tag?: string }>;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const drizzleDir = join(process.cwd(), 'drizzle');
const metaDir = join(drizzleDir, 'meta');
const journalPath = join(metaDir, '_journal.json');

if (!existsSync(journalPath)) {
  fail(`Drizzle journal not found at ${journalPath}`);
}

const journal = (await Bun.file(journalPath).json()) as Journal;
const entries = journal.entries ?? [];
const latest = entries.at(-1);

if (!latest?.tag) {
  fail('Drizzle journal has no migration entries.');
}

const latestPrefix = latest.tag.split('_')[0];
const latestSqlPath = join(drizzleDir, `${latest.tag}.sql`);
const latestSnapshotPath = join(metaDir, `${latestPrefix}_snapshot.json`);

const problems: string[] = [];

if (!existsSync(latestSqlPath)) {
  problems.push(`missing latest migration SQL: drizzle/${latest.tag}.sql`);
}

if (!existsSync(latestSnapshotPath)) {
  problems.push(`missing latest migration snapshot: drizzle/meta/${latestPrefix}_snapshot.json`);
}

const sqlTags = new Set(
  readdirSync(drizzleDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.replace(/\.sql$/, '')),
);
const journalTags = new Set(entries.map((entry) => entry.tag).filter(Boolean));

for (const tag of sqlTags) {
  if (!journalTags.has(tag)) {
    problems.push(`migration SQL is not listed in _journal.json: drizzle/${tag}.sql`);
  }
}

if (problems.length > 0) {
  fail([
    'Drizzle migration metadata is out of sync.',
    '',
    ...problems.map((problem) => `- ${problem}`),
    '',
    'Do not run db:generate/db:migrate until SQL, meta snapshot, and _journal.json agree.',
  ].join('\n'));
}

console.log('Drizzle migration metadata ok');
