import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(projectRoot, "drizzle");

async function run() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置，无法执行数据库迁移");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    for (const filename of filenames) {
      const alreadyApplied = await sql`
        SELECT 1 FROM knowledge_migrations WHERE name = ${filename} LIMIT 1
      `;
      if (alreadyApplied.length > 0) {
        console.log(`skip ${filename}`);
        continue;
      }

      const source = await readFile(join(migrationsDirectory, filename), "utf8");
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('knowledge-context-v2-migrations'))`;
        const concurrentResult = await tx`
          SELECT 1 FROM knowledge_migrations WHERE name = ${filename} LIMIT 1
        `;
        if (concurrentResult.length > 0) return;
        await tx.unsafe(source, [], { prepare: false });
        await tx`INSERT INTO knowledge_migrations (name) VALUES (${filename})`;
      });
      console.log(`applied ${filename}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
