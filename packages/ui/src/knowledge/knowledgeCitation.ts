export type KnowledgeCitationReference = {
  documentId: string;
  versionId: string;
  blockId?: string;
  page?: number;
  excerpt: string;
  startOffset?: number;
  endOffset?: number;
};

export type KnowledgeNavigationTarget = KnowledgeCitationReference & { navigationId: string };

export type KnowledgeReaderTarget = KnowledgeNavigationTarget | {
  kind: "publication";
  versionId: string;
  navigationId: string;
};
