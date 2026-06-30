import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function getDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return process.env.DATABASE_URL;
}

let _pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return _pool;
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
let _db: DrizzleDb | null = null;
function getDb(): DrizzleDb {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

// Proxies are used to lazily initialize pool and db.
// This prevents the application/tests/scaffold from failing immediately at import time when DATABASE_URL is missing,
// which is required for isolating this unused package in local environments.
export const pool = new Proxy({} as pg.Pool, {
  get(target, prop, receiver) {
    const p = getPool();
    const value = Reflect.get(p, prop);
    return typeof value === "function" ? value.bind(p) : value;
  },
  set(target, prop, value, receiver) {
    return Reflect.set(getPool(), prop, value);
  },
});

export const db = new Proxy({} as DrizzleDb, {
  get(target, prop, receiver) {
    const d = getDb();
    const value = Reflect.get(d, prop);
    return typeof value === "function" ? value.bind(d) : value;
  },
  set(target, prop, value, receiver) {
    return Reflect.set(getDb(), prop, value);
  },
});

export * from "./schema";
