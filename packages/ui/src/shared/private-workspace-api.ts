import { apiRequest, type AnswerFeedback, type AskArdenAnswer } from "./api-client";
import type { Platform } from "./types";

/**
 * Typed client for the owner-only private workspace (ADR 0002, ADR 0029).
 * Shapes follow docs/features/private-notes-organization/API.md.
 */
export type PrivateNoteSummary = {
  id: string;
  organizationId: string;
  title: string;
  currentVersion: { id: string; version: number; mimeType?: string; contentHash?: string };
  createdAt: string;
  updatedAt: string;
  collectionId: string | null;
  favoritedAt: string | null;
  /** Spec F03-ARR order inside the collection or root; null sorts first. */
  position?: number | null;
  /** Set only on an archive response for an archived note. */
  archivedAt?: string | null;
  /** Decision 0034: "pdf" for an original PDF kept in Private. */
  kind?: "note" | "pdf";
};
export type PrivateNoteRecord = PrivateNoteSummary & {
  body: string;
  version?: number;
  /** For a PDF item: whether text was extracted for the private AI side panel. */
  textAvailable?: boolean;
};
/** An original PDF in Private (decision 0034). `text` is what the browser extracted; empty for a scan. */
export type PrivatePdfUpload = { title: string; pdfBase64: string; text: string };

export function askPrivateNote(platform: Platform, organizationId: string, noteId: string,
  expectedVersion: number, query: string, requestId: string): Promise<AskArdenAnswer> {
  return apiRequest(platform, `/api/v1/organizations/${organizationId}/private-workspace/drafts/${noteId}/questions`, {
    method: "POST", body: JSON.stringify({ expectedVersion, query, requestId }),
  });
}

export function ratePrivateAnswer(platform: Platform, organizationId: string, token: string, feedback: AnswerFeedback) {
  return apiRequest<{ feedback: AnswerFeedback }>(platform, `/api/v1/organizations/${organizationId}/ai/private-feedback`, {
    method: "PUT", body: JSON.stringify({ token, feedback }),
  });
}
export type PrivateCollectionRecord = {
  id: string;
  title: string;
  parentId: string | null;
  favoritedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type PrivateTrashEntry = {
  batchId: string;
  kind: "note" | "collection";
  id: string;
  title: string;
  fromCollectionTitle: string | null;
  itemCount: number;
  trashedAt: string;
  purgeAfter: string;
};
/** A note in the Archived view (spec F03-ARR); `collectionId` is where Unarchive returns it (null = root). */
export type PrivateArchivedNote = {
  id: string;
  title: string;
  collectionId: string | null;
  collectionTitle: string | null;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
};
export type PrivateArchiveList = { items: PrivateArchivedNote[]; hasMore: boolean };
export type PrivateNoteList = { items: PrivateNoteSummary[]; nextCursor: string | null };
export type DuplicatedCollection = { collection: PrivateCollectionRecord; collections: PrivateCollectionRecord[]; notes: PrivateNoteSummary[] };
export type RestoredTrash = { collections: PrivateCollectionRecord[]; notes: PrivateNoteSummary[] };

function base(organizationId: string) {
  return `/api/v1/organizations/${organizationId}/private-workspace`;
}

const json = (method: "POST" | "PATCH" | "PUT", body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, body: JSON.stringify(body) };

export function listPrivateNotes(platform: Platform, organizationId: string, cursor: string | null): Promise<PrivateNoteList> {
  const query = new URLSearchParams({ limit: "100" });
  if (cursor) query.set("cursor", cursor);
  return apiRequest<PrivateNoteList>(platform, `${base(organizationId)}/drafts?${query}`);
}

export function loadPrivateNote(platform: Platform, organizationId: string, noteId: string): Promise<PrivateNoteRecord> {
  return apiRequest<PrivateNoteRecord>(platform, `${base(organizationId)}/drafts/${noteId}`);
}

export function createPrivateNote(platform: Platform, organizationId: string,
  input: { title: string; body: string; collectionId?: string | null }): Promise<PrivateNoteRecord> {
  const body = input.collectionId ? input : { title: input.title, body: input.body };
  return apiRequest<PrivateNoteRecord>(platform, `${base(organizationId)}/drafts`, json("POST", body));
}

/** Content edits and renames create a new version and must carry the version they were based on. A PDF item takes a title only. */
export function updatePrivateNote(platform: Platform, organizationId: string, noteId: string, version: number,
  input: { title: string; body?: string }): Promise<PrivateNoteRecord> {
  return apiRequest<PrivateNoteRecord>(platform, `${base(organizationId)}/drafts/${noteId}`, {
    ...json("PATCH", input), headers: { "If-Match": `"${version}"` },
  });
}

export function createPrivatePdf(platform: Platform, organizationId: string,
  input: PrivatePdfUpload & { collectionId?: string | null }): Promise<PrivateNoteRecord> {
  const body = input.collectionId ? input : { title: input.title, pdfBase64: input.pdfBase64, text: input.text };
  return apiRequest<PrivateNoteRecord>(platform, `${base(organizationId)}/drafts/pdf`, json("POST", body));
}

/** Replaces a PDF item's file; the item keeps its title unless one is given. */
export function replacePrivatePdf(platform: Platform, organizationId: string, noteId: string, version: number,
  input: { pdfBase64: string; text: string }): Promise<PrivateNoteRecord> {
  return apiRequest<PrivateNoteRecord>(platform, `${base(organizationId)}/drafts/${noteId}/pdf`, {
    ...json("PUT", input), headers: { "If-Match": `"${version}"` },
  });
}

export async function loadPrivatePdf(platform: Platform, organizationId: string, noteId: string): Promise<string> {
  return (await apiRequest<{ pdfBase64: string }>(platform, `${base(organizationId)}/drafts/${noteId}/pdf`)).pdfBase64;
}

export async function listPrivateCollections(platform: Platform, organizationId: string): Promise<PrivateCollectionRecord[]> {
  return (await apiRequest<{ items: PrivateCollectionRecord[] }>(platform, `${base(organizationId)}/collections`)).items;
}

export function createPrivateCollection(platform: Platform, organizationId: string,
  input: { title: string; parentId?: string | null }): Promise<PrivateCollectionRecord> {
  return apiRequest<PrivateCollectionRecord>(platform, `${base(organizationId)}/collections`, json("POST", input));
}

export function updatePrivateCollection(platform: Platform, organizationId: string, collectionId: string,
  input: { title?: string; parentId?: string | null }): Promise<PrivateCollectionRecord> {
  return apiRequest<PrivateCollectionRecord>(platform, `${base(organizationId)}/collections/${collectionId}`, json("PATCH", input));
}

/** Moves a note into a collection (null = root) at a 0-based `index` of its order, or last when no index is given. */
export function movePrivateNote(platform: Platform, organizationId: string, noteId: string, collectionId: string | null,
  index: number | null = null): Promise<PrivateNoteSummary> {
  return apiRequest<PrivateNoteSummary>(platform, `${base(organizationId)}/drafts/${noteId}/collection`,
    json("PUT", index === null ? { collectionId } : { collectionId, index }));
}

export function setPrivateNoteArchived(platform: Platform, organizationId: string, noteId: string, archived: boolean): Promise<PrivateNoteSummary> {
  return apiRequest<PrivateNoteSummary>(platform, `${base(organizationId)}/drafts/${noteId}/archive`, json("PUT", { archived }));
}

export function listPrivateArchive(platform: Platform, organizationId: string): Promise<PrivateArchiveList> {
  return apiRequest<PrivateArchiveList>(platform, `${base(organizationId)}/archive`);
}

export function setPrivateNoteFavorite(platform: Platform, organizationId: string, noteId: string, favorite: boolean): Promise<PrivateNoteSummary> {
  return apiRequest<PrivateNoteSummary>(platform, `${base(organizationId)}/drafts/${noteId}/favorite`, json("PUT", { favorite }));
}

export function setPrivateCollectionFavorite(platform: Platform, organizationId: string, collectionId: string, favorite: boolean): Promise<PrivateCollectionRecord> {
  return apiRequest<PrivateCollectionRecord>(platform, `${base(organizationId)}/collections/${collectionId}/favorite`, json("PUT", { favorite }));
}

export function duplicatePrivateNote(platform: Platform, organizationId: string, noteId: string): Promise<PrivateNoteRecord> {
  return apiRequest<PrivateNoteRecord>(platform, `${base(organizationId)}/drafts/${noteId}/duplicate`, json("POST"));
}

export function duplicatePrivateCollection(platform: Platform, organizationId: string, collectionId: string): Promise<DuplicatedCollection> {
  return apiRequest<DuplicatedCollection>(platform, `${base(organizationId)}/collections/${collectionId}/duplicate`, json("POST"));
}

export function trashPrivateNote(platform: Platform, organizationId: string, noteId: string): Promise<PrivateTrashEntry> {
  return apiRequest<PrivateTrashEntry>(platform, `${base(organizationId)}/drafts/${noteId}/trash`, json("POST"));
}

export function trashPrivateCollection(platform: Platform, organizationId: string, collectionId: string): Promise<PrivateTrashEntry> {
  return apiRequest<PrivateTrashEntry>(platform, `${base(organizationId)}/collections/${collectionId}/trash`, json("POST"));
}

export async function listPrivateTrash(platform: Platform, organizationId: string): Promise<PrivateTrashEntry[]> {
  return (await apiRequest<{ items: PrivateTrashEntry[] }>(platform, `${base(organizationId)}/trash`)).items;
}

export function restorePrivateTrash(platform: Platform, organizationId: string, batchId: string): Promise<RestoredTrash> {
  return apiRequest<RestoredTrash>(platform, `${base(organizationId)}/trash/${batchId}/restore`, json("POST"));
}

/** Permanent: erases the batch's content; there is no undo. */
export async function purgePrivateTrash(platform: Platform, organizationId: string, batchId: string): Promise<void> {
  await apiRequest<void>(platform, `${base(organizationId)}/trash/${batchId}/purge`, json("POST"));
}
