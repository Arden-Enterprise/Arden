export const knowledgeClassifications = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;

export type KnowledgeClassification = (typeof knowledgeClassifications)[number];

export function isKnowledgeClassification(value: unknown): value is KnowledgeClassification {
  return typeof value === "string" && knowledgeClassifications.some((classification) => classification === value);
}
