import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://knowledge:knowledge@127.0.0.1:54329/knowledge_v2",
  },
  strict: true,
  verbose: true,
});
