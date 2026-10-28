export type KnowledgeCitationReference = {
  documentId: string;
  versionId: string;
  blockId?: string;
  page?: number;
  excerpt: string;
};

export type KnowledgeNavigationTarget = KnowledgeCitationReference & {
  navigationId: string;
};
