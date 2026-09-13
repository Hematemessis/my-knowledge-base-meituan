import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const runtime = globalThis as typeof globalThis & {
  knowledgeSql?: ReturnType<typeof postgres>;
  knowledgeDb?: Database;
};

export function getDatabase(): Database {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法使用 PostgreSQL 存储");
  }

  if (!runtime.knowledgeSql) {
    runtime.knowledgeSql = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  if (!runtime.knowledgeDb) {
    runtime.knowledgeDb = drizzle(runtime.knowledgeSql, { schema });
  }

  return runtime.knowledgeDb;
}

export async function closeDatabase(): Promise<void> {
  if (runtime.knowledgeSql) {
    await runtime.knowledgeSql.end({ timeout: 5 });
  }
  delete runtime.knowledgeSql;
  delete runtime.knowledgeDb;
}
