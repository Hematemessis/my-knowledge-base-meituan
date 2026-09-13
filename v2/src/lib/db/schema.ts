import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const memoryScopeEnum = pgEnum("memory_scope", ["global", "project"]);
export const memoryTypeEnum = pgEnum("memory_type", [
  "fact",
  "preference",
  "decision",
  "goal",
  "workflow",
  "episode",
]);
export const memoryStatusEnum = pgEnum("memory_status", [
  "pending",
  "active",
  "superseded",
  "rejected",
  "archived",
]);
export const candidateStatusEnum = pgEnum("candidate_status", [
  "pending",
  "accepted",
  "rejected",
  "merged",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
};

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().default("local-user"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().default("local-user"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    actor: text("actor").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("events_project_created_idx").on(table.projectId, table.createdAt),
    index("events_kind_created_idx").on(table.kind, table.createdAt),
  ],
);

export const memoryCandidates = pgTable(
  "memory_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().default("local-user"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    scope: memoryScopeEnum("scope").notNull(),
    type: memoryTypeEnum("type").notNull(),
    subject: text("subject").notNull().default(""),
    statement: text("statement").notNull(),
    confidence: real("confidence").notNull().default(0.5),
    importance: integer("importance").notNull().default(50),
    status: candidateStatusEnum("status").notNull().default("pending"),
    decisionReason: text("decision_reason").notNull().default(""),
    reviewAction: text("review_action"),
    targetMemoryId: uuid("target_memory_id"),
    resultMemoryId: uuid("result_memory_id"),
    reviewEventId: uuid("review_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    resultVersion: integer("result_version"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    index("memory_candidates_status_idx").on(table.status, table.createdAt),
    index("memory_candidates_result_memory_idx").on(table.resultMemoryId),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().default("local-user"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    scope: memoryScopeEnum("scope").notNull(),
    type: memoryTypeEnum("type").notNull(),
    subject: text("subject").notNull().default(""),
    statement: text("statement").notNull(),
    status: memoryStatusEnum("status").notNull().default("active"),
    importance: integer("importance").notNull().default(50),
    confidence: real("confidence").notNull().default(1),
    dedupeKey: text("dedupe_key"),
    sourceEventId: uuid("source_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    supersedesId: uuid("supersedes_id"),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      mode: "string",
    }),
    lastConfirmedAt: timestamp("last_confirmed_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      mode: "string",
    }),
    embedding: vector("embedding", { dimensions: 1024 }),
    ...timestamps,
  },
  (table) => [
    index("memories_scope_status_idx").on(
      table.scope,
      table.status,
      table.updatedAt,
    ),
    index("memories_project_status_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const memoryVersions = pgTable(
  "memory_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    statement: text("statement").notNull(),
    subject: text("subject").notNull().default(""),
    importance: integer("importance").notNull().default(50),
    confidence: real("confidence").notNull().default(1),
    changeReason: text("change_reason").notNull().default(""),
    sourceEventId: uuid("source_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memory_versions_memory_version_idx").on(
      table.memoryId,
      table.version,
    ),
  ],
);

export const memoryRelations = pgTable(
  "memory_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromMemoryId: uuid("from_memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    toMemoryId: uuid("to_memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memory_relations_unique_idx").on(
      table.fromMemoryId,
      table.toMemoryId,
      table.relation,
    ),
  ],
);

export const projectStates = pgTable("project_states", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  goal: text("goal").notNull().default(""),
  phase: text("phase").notNull().default(""),
  state: jsonb("state")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  openDecisions: jsonb("open_decisions")
    .$type<Array<Record<string, unknown>>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const contextSnapshots = pgTable("context_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().default("local-user"),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  query: text("query").notNull(),
  selectedMemoryIds: uuid("selected_memory_ids").array().notNull(),
  sections: jsonb("sections")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  tokenBudget: integer("token_budget").notNull(),
  estimatedTokens: integer("estimated_tokens").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const memoryUsageLogs = pgTable("memory_usage_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  memoryId: uuid("memory_id")
    .notNull()
    .references(() => memories.id, { onDelete: "cascade" }),
  contextSnapshotId: uuid("context_snapshot_id").references(
    () => contextSnapshots.id,
    { onDelete: "cascade" },
  ),
  rank: integer("rank").notNull(),
  score: real("score").notNull(),
  feedback: text("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().default("local-user"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (table) => [index("jobs_poll_idx").on(table.status, table.availableAt)],
);
