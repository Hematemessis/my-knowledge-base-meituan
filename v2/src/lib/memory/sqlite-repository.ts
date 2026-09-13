import { localDatabasePath, openLocalDatabase } from "../local-database";
import { InMemoryMemoryRepository, type MemoryState } from "./in-memory-repository";
import type { MemoryRepository } from "./repository";

type Args<K extends keyof Omit<MemoryRepository, "storageMode">> = Parameters<MemoryRepository[K]>;

/** Reuse the tested lifecycle, committing its complete state only on success.
 * Revision compare-and-swap prevents lost updates across concurrent requests/processes.
 * No SQLite transaction is held over an await (which could block the Node event loop).
 */
export class SQLiteMemoryRepository implements MemoryRepository {
  readonly storageMode = "sqlite" as const;
  private db;

  constructor(path: string, options: { seed?: boolean } = {}) {
    this.db = openLocalDatabase(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_state (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);`);
    this.db.prepare("INSERT OR IGNORE INTO memory_state VALUES (1,0,?)")
      .run(JSON.stringify(new InMemoryMemoryRepository(options).exportState()));
  }

  close() { this.db.close(); }

  private read() {
    const row = this.db.prepare("SELECT revision,payload FROM memory_state WHERE id=1").get()!;
    return { revision: Number(row.revision), repository: new InMemoryMemoryRepository({
      state: JSON.parse(String(row.payload)) as MemoryState,
    }) };
  }

  private async write<T>(operation: (repository: InMemoryMemoryRepository) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { revision, repository } = this.read();
      const result = await operation(repository);
      const committed = this.db.prepare("UPDATE memory_state SET payload=?,revision=revision+1 WHERE id=1 AND revision=?")
        .run(JSON.stringify(repository.exportState()), revision);
      if (committed.changes === 1) return result;
    }
    throw new Error("记忆正在被其他操作更新，请重试");
  }

  recordEvent(...args: Args<"recordEvent">) { return this.write(r => r.recordEvent(...args)); }
  captureConfirmedMemory(...args: Args<"captureConfirmedMemory">) { return this.write(r => r.captureConfirmedMemory(...args)); }
  captureMemoryCandidates(...args: Args<"captureMemoryCandidates">) { return this.write(r => r.captureMemoryCandidates(...args)); }
  reviewMemoryCandidate(...args: Args<"reviewMemoryCandidate">) { return this.write(r => r.reviewMemoryCandidate(...args)); }
  undoMemoryCandidateReview(...args: Args<"undoMemoryCandidateReview">) { return this.write(r => r.undoMemoryCandidateReview(...args)); }
  restoreMemoryVersion(...args: Args<"restoreMemoryVersion">) { return this.write(r => r.restoreMemoryVersion(...args)); }
  saveContextSnapshot(...args: Args<"saveContextSnapshot">) { return this.write(r => r.saveContextSnapshot(...args)); }
  listMemories(...args: Args<"listMemories">) { return this.read().repository.listMemories(...args); }
  listMemoryCandidates(...args: Args<"listMemoryCandidates">) { return this.read().repository.listMemoryCandidates(...args); }
  listMemoryVersions(...args: Args<"listMemoryVersions">) { return this.read().repository.listMemoryVersions(...args); }
}

const runtime = globalThis as typeof globalThis & { knowledgeSQLiteMemory?: SQLiteMemoryRepository };
export function getSQLiteMemoryRepository() {
  return runtime.knowledgeSQLiteMemory ??= new SQLiteMemoryRepository(localDatabasePath());
}
