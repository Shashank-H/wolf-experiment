type UnknownRecord = Record<string, unknown>;

function records(error: unknown): UnknownRecord[] {
  const found: UnknownRecord[] = [];
  let current: unknown = error;
  while (current && typeof current === 'object') {
    found.push(current as UnknownRecord);
    current = (current as { cause?: unknown }).cause;
  }
  return found;
}

export function databaseErrorCode(error: unknown): string | undefined {
  for (const record of records(error)) {
    if (typeof record.code === 'string') return record.code;
  }
  return undefined;
}

export function databaseConstraint(error: unknown): string | undefined {
  for (const record of records(error)) {
    if (typeof record.constraint_name === 'string') return record.constraint_name;
    if (typeof record.constraint === 'string') return record.constraint;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (databaseErrorCode(error) !== '23505') return false;
  return constraint ? databaseConstraint(error) === constraint : true;
}

export function isMissingTable(error: unknown): boolean {
  return databaseErrorCode(error) === '42P01';
}

export function safeDatabaseMessage(error: unknown): string {
  if (isMissingTable(error)) return 'Database is not migrated. Run `bun run db:migrate` and try again.';
  return 'Database request failed';
}
