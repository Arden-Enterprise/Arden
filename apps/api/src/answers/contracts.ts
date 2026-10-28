const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export type AiAnswerRequest = {
  contractVersion: 1;
  requestId: string;
  organizationId: string;
  query: string;
  allowedGenerationIds: string[];
};

export type AiAnswerCitation = {
  generationId: string;
  snapshotVersionId: string;
  snapshotContentHash: string;
  chunkId: string;
  sourceBlockIds: string[];
  parentSectionBlockId: string | null;
  excerpt: string;
};

export type AiAnswerResponse = {
  contractVersion: 1;
  requestId: string;
  status: "ANSWERED" | "INSUFFICIENT_EVIDENCE";
  answer: string;
  citations: AiAnswerCitation[];
};

export class AiAnswerContractError extends Error {
  readonly code = "AI_ANSWER_INVALID";
}

export function parseAiAnswerResponse(value: unknown, request: AiAnswerRequest): AiAnswerResponse {
  const response = objectValue(value);
  exactKeys(response, ["contractVersion", "requestId", "status", "answer", "citations"]);
  if (response.contractVersion !== 1 || response.requestId !== request.requestId) invalid();
  if (response.status !== "ANSWERED" && response.status !== "INSUFFICIENT_EVIDENCE") invalid();
  if (typeof response.answer !== "string" || response.answer.length === 0 || response.answer.length > 12_000) invalid();
  if (!Array.isArray(response.citations) || response.citations.length > 12) invalid();
  const citations = response.citations.map(parseCitation);
  if ((response.status === "ANSWERED") !== (citations.length > 0)) invalid();
  return { contractVersion: 1, requestId: request.requestId, status: response.status,
    answer: response.answer, citations };
}

function parseCitation(value: unknown): AiAnswerCitation {
  const citation = objectValue(value);
  exactKeys(citation, ["generationId", "snapshotVersionId", "snapshotContentHash", "chunkId",
    "sourceBlockIds", "parentSectionBlockId", "excerpt"]);
  const generationId = uuid(citation.generationId);
  const snapshotVersionId = uuid(citation.snapshotVersionId);
  const snapshotContentHash = sha256(citation.snapshotContentHash);
  const chunkId = sha256(citation.chunkId);
  if (!Array.isArray(citation.sourceBlockIds) || citation.sourceBlockIds.length === 0
    || citation.sourceBlockIds.length > 100 || citation.sourceBlockIds.some((id) =>
      typeof id !== "string" || id.length === 0 || id.length > 200)) invalid();
  if (citation.parentSectionBlockId !== null
    && (typeof citation.parentSectionBlockId !== "string" || citation.parentSectionBlockId.length === 0
      || citation.parentSectionBlockId.length > 200)) invalid();
  if (typeof citation.excerpt !== "string" || citation.excerpt.length === 0 || citation.excerpt.length > 1_200) invalid();
  return { generationId, snapshotVersionId, snapshotContentHash, chunkId,
    sourceBlockIds: citation.sourceBlockIds as string[],
    parentSectionBlockId: citation.parentSectionBlockId as string | null, excerpt: citation.excerpt };
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid();
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) invalid();
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) invalid();
  return value;
}

function invalid(): never {
  throw new AiAnswerContractError("Arden-AI returned an invalid answer contract");
}
