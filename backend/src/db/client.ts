import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env';
import * as schema from './schema';

export const sql = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(sql, { schema });

export async function checkDatabase(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
