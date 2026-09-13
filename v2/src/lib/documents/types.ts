export interface DocumentSummary {
  id: string;
  projectId: string;
  name: string;
  version: number;
  size: number;
  updatedAt: string;
  characters: number;
  truncated: boolean;
}

export interface DocumentChunk {
  id: string;
  ordinal: number;
  text: string;
  start: number;
  end: number;
}

export interface DocumentVersion extends DocumentSummary {
  chunks: DocumentChunk[];
  versions: Array<{ version: number; name: string; updatedAt: string }>;
}

export interface Evidence extends DocumentChunk {
  documentId: string;
  name: string;
  version: number;
  updatedAt: string;
  citation: number;
}
