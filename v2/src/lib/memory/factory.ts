import type { MemoryRepository } from "./repository";

export async function getMemoryRepository(): Promise<MemoryRepository> {
  if (!process.env.DATABASE_URL) {
    const { getSQLiteMemoryRepository } = await import("./sqlite-repository");
    return getSQLiteMemoryRepository();
  }

  const { PostgresMemoryRepository } = await import("./postgres-repository");
  return new PostgresMemoryRepository();
}
