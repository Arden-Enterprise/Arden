import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DraftListItem, PrivateDraft, StoredContentFields } from "../db/repository.js";
import type { PrivateContentStorage } from "./content-storage.js";
import { maxListedCollections, PrivateCollectionLimitError } from "./organization-store.js";
import type { PrivateArchivedNote, PrivateCollection, PrivateNoteSource, PrivateOrganizationStore, PrivateTrashEntry } from "./organization-store.js";
import { erasePurgedContent, privateTrashPurgeAfter } from "./trash-retention.js";

type RequestActor = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;

const maxCollectionTitleCodePoints = 200;
const maxNoteTitleCodePoints = 200;
const copySuffix = " (copy)";
/** Bounds the synchronous content copy of one collection duplicate request. */
export const maxDuplicatedNotes = 500;
export const maxDuplicatedCollections = 1_000;
/** Larger indexes are accepted by clamping to the end; this only bounds the request. */
const maxPlacementIndex = 1_000_000;

export function representNoteSummary(item: DraftListItem) {
  return {
    id: item.id, organizationId: item.organizationId, title: item.title,
    currentVersion: item.currentVersion,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
    collectionId: item.collectionId, favoritedAt: item.favoritedAt?.toISOString() ?? null,
    position: item.position, archivedAt: item.archivedAt?.toISOString() ?? null,
  };
}

export function representPrivateNote(draft: PrivateDraft, body: string) {
  return {
    id: draft.id, organizationId: draft.organizationId, title: draft.title, body,
    currentVersion: { id: draft.versionId, version: draft.currentVersion, mimeType: draft.mimeType, contentHash: draft.contentHash },
    version: draft.currentVersion,
    createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString(),
    collectionId: draft.collectionId, favoritedAt: draft.favoritedAt?.toISOString() ?? null,
    position: draft.position,
  };
}

function representCollection(collection: PrivateCollection) {
  return {
    id: collection.id, title: collection.title, parentId: collection.parentId,
    favoritedAt: collection.favoritedAt?.toISOString() ?? null,
    createdAt: collection.createdAt.toISOString(), updatedAt: collection.updatedAt.toISOString(),
  };
}

function representArchivedNote(note: PrivateArchivedNote) {
  return {
    id: note.id, title: note.title, collectionId: note.collectionId, collectionTitle: note.collectionTitle,
    archivedAt: note.archivedAt.toISOString(), createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString(),
  };
}

function representTrashEntry(entry: PrivateTrashEntry) {
  return {
    batchId: entry.batchId, kind: entry.kind, id: entry.id, title: entry.title,
    fromCollectionTitle: entry.fromCollectionTitle, itemCount: entry.itemCount,
    trashedAt: entry.trashedAt.toISOString(), purgeAfter: privateTrashPurgeAfter(entry.trashedAt).toISOString(),
  };
}

export function normalizeCollectionTitle(title: string): string | null {
  if (title.includes("\u0000") || Array.from(title).length > maxCollectionTitleCodePoints) return null;
  return title.trim() || "Untitled collection";
}

export function copyTitle(title: string, maxCodePoints: number): string {
  return `${Array.from(title).slice(0, maxCodePoints - copySuffix.length).join("")}${copySuffix}`;
}

export function registerPrivateOrganizationRoutes(app: FastifyInstance, input: {
  store: PrivateOrganizationStore;
  storage: PrivateContentStorage;
  requestActor: RequestActor;
  uuidPattern: string;
}) {
  const { store, storage, requestActor, uuidPattern } = input;
  const base = "/api/v1/organizations/:organizationId/private-workspace";
  const uuid = { type: "string", pattern: uuidPattern } as const;
  const nullableUuid = { anyOf: [uuid, { type: "null" }] } as const;
  const params = (...names: string[]) => ({
    type: "object", required: ["organizationId", ...names],
    properties: Object.fromEntries(["organizationId", ...names].map((name) => [name, uuid])),
  });
  const favoriteBody = { type: "object", additionalProperties: false, required: ["favorite"], properties: { favorite: { type: "boolean" } } };
  const notFound = (reply: FastifyReply, request: FastifyRequest) => reply.code(404).send(safeError("RESOURCE_NOT_AVAILABLE", "This resource is not available.", request.id));
  const failed = (reply: FastifyReply, request: FastifyRequest, error: unknown, operation: string) => {
    if (error instanceof PrivateCollectionLimitError) {
      return reply.code(409).send(safeError("COLLECTION_LIMIT_REACHED",
        `You can have up to ${maxListedCollections} collections. Delete or merge some collections first.`, request.id));
    }
    request.log.error({ errorType: error instanceof Error ? error.name : "UnknownError", requestId: request.id }, `Private ${operation} failed`);
    return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
  };
  const noStore = (reply: FastifyReply) => reply.header("Cache-Control", "no-store");

  app.get<{ Params: { organizationId: string } }>(`${base}/collections`, { schema: { params: params() } }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const collections = await store.listCollections(actor.userId, request.params.organizationId);
      if (!collections) return notFound(reply, request);
      return noStore(reply).send({ items: collections.map(representCollection) });
    } catch (error) { return failed(reply, request, error, "collection list"); }
  });

  app.post<{ Params: { organizationId: string }; Body: { title: string; parentId?: string | null } }>(`${base}/collections`, {
    schema: {
      params: params(),
      body: { type: "object", additionalProperties: false, required: ["title"],
        properties: { title: { type: "string", maxLength: maxCollectionTitleCodePoints }, parentId: nullableUuid } },
    },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    const title = normalizeCollectionTitle(request.body.title);
    if (!title) return reply.code(400).send(safeError("INVALID_REQUEST", "The collection is invalid.", request.id));
    try {
      const collection = await store.createCollection(actor.userId, request.params.organizationId,
        { title, parentId: request.body.parentId ?? null }, request.id);
      if (!collection) return notFound(reply, request);
      return noStore(reply).code(201).send(representCollection(collection));
    } catch (error) { return failed(reply, request, error, "collection creation"); }
  });

  app.patch<{ Params: { organizationId: string; collectionId: string }; Body: { title?: string; parentId?: string | null } }>(`${base}/collections/:collectionId`, {
    schema: {
      params: params("collectionId"),
      body: { type: "object", additionalProperties: false, minProperties: 1,
        properties: { title: { type: "string", maxLength: maxCollectionTitleCodePoints }, parentId: nullableUuid } },
    },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    const title = request.body.title === undefined ? undefined : normalizeCollectionTitle(request.body.title);
    if (title === null) return reply.code(400).send(safeError("INVALID_REQUEST", "The collection is invalid.", request.id));
    try {
      const result = await store.updateCollection(actor.userId, request.params.organizationId, request.params.collectionId,
        { ...(title !== undefined ? { title } : {}), ...("parentId" in request.body ? { parentId: request.body.parentId ?? null } : {}) },
        request.id);
      if (result.kind === "not-found") return notFound(reply, request);
      if (result.kind === "cycle") {
        return reply.code(409).send(safeError("COLLECTION_CYCLE", "A collection cannot be moved into itself or one of its collections.", request.id));
      }
      return noStore(reply).send(representCollection(result.collection));
    } catch (error) { return failed(reply, request, error, "collection update"); }
  });

  // `index` (spec F03-ARR) places the note at that 0-based position of the destination; without it the note goes last.
  app.put<{ Params: { organizationId: string; draftId: string }; Body: { collectionId: string | null; index?: number } }>(`${base}/drafts/:draftId/collection`, {
    schema: {
      params: params("draftId"),
      body: { type: "object", additionalProperties: false, required: ["collectionId"],
        properties: { collectionId: nullableUuid, index: { type: "integer", minimum: 0, maximum: maxPlacementIndex } } },
    },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const note = await store.moveNote(actor.userId, request.params.organizationId, request.params.draftId,
        request.body.collectionId, request.body.index ?? null);
      if (!note) return notFound(reply, request);
      return noStore(reply).send(representNoteSummary(note));
    } catch (error) { return failed(reply, request, error, "note move"); }
  });

  app.put<{ Params: { organizationId: string; draftId: string }; Body: { favorite: boolean } }>(`${base}/drafts/:draftId/favorite`, {
    schema: { params: params("draftId"), body: favoriteBody },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const note = await store.setNoteFavorite(actor.userId, request.params.organizationId, request.params.draftId, request.body.favorite);
      if (!note) return notFound(reply, request);
      return noStore(reply).send(representNoteSummary(note));
    } catch (error) { return failed(reply, request, error, "note favorite"); }
  });

  app.put<{ Params: { organizationId: string; draftId: string }; Body: { archived: boolean } }>(`${base}/drafts/:draftId/archive`, {
    schema: {
      params: params("draftId"),
      body: { type: "object", additionalProperties: false, required: ["archived"], properties: { archived: { type: "boolean" } } },
    },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const note = await store.setNoteArchived(actor.userId, request.params.organizationId, request.params.draftId,
        request.body.archived, request.id);
      if (!note) return notFound(reply, request);
      return noStore(reply).send(representNoteSummary(note));
    } catch (error) { return failed(reply, request, error, "note archive"); }
  });

  app.get<{ Params: { organizationId: string } }>(`${base}/archive`, { schema: { params: params() } }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const archived = await store.listArchived(actor.userId, request.params.organizationId);
      if (!archived) return notFound(reply, request);
      return noStore(reply).send({ items: archived.items.map(representArchivedNote), hasMore: archived.hasMore });
    } catch (error) { return failed(reply, request, error, "archive list"); }
  });

  app.put<{ Params: { organizationId: string; collectionId: string }; Body: { favorite: boolean } }>(`${base}/collections/:collectionId/favorite`, {
    schema: { params: params("collectionId"), body: favoriteBody },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const collection = await store.setCollectionFavorite(actor.userId, request.params.organizationId,
        request.params.collectionId, request.body.favorite);
      if (!collection) return notFound(reply, request);
      return noStore(reply).send(representCollection(collection));
    } catch (error) { return failed(reply, request, error, "collection favorite"); }
  });

  app.post<{ Params: { organizationId: string; draftId: string } }>(`${base}/drafts/:draftId/duplicate`, {
    schema: { params: params("draftId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    const { organizationId, draftId } = request.params;
    try {
      const source = await store.getNoteSource(actor.userId, organizationId, draftId);
      if (!source) return notFound(reply, request);
      const { body, copy } = await copyContent(storage, source);
      // An explicit "not current" answer is a committed no-op, so the new object is removed.
      // A thrown error has an unknown commit outcome and keeps the copy.
      const draft = await store.duplicateNote(actor.userId, organizationId, source,
        copyTitle(source.title, maxNoteTitleCodePoints), copy, request.id);
      if (!draft) {
        await storage.remove(copy.sourceUri);
        return notFound(reply, request);
      }
      reply.header("Location", `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draft.id}`);
      reply.header("ETag", `"${draft.currentVersion}"`);
      return noStore(reply).code(201).send(representPrivateNote(draft, body));
    } catch (error) { return failed(reply, request, error, "note duplicate"); }
  });

  app.post<{ Params: { organizationId: string; collectionId: string } }>(`${base}/collections/:collectionId/duplicate`, {
    schema: { params: params("collectionId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    const { organizationId, collectionId } = request.params;
    const copies = new Map<string, StoredContentFields>();
    try {
      const subtree = await store.getCollectionSubtree(actor.userId, organizationId, collectionId);
      if (!subtree) return notFound(reply, request);
      if (subtree.notes.length > maxDuplicatedNotes || subtree.collections.length > maxDuplicatedCollections) {
        return reply.code(409).send(safeError("COLLECTION_TOO_LARGE", "This collection is too large to duplicate at once.", request.id));
      }
      for (const note of subtree.notes) copies.set(note.id, (await copyContent(storage, note)).copy);
      const result = await store.duplicateCollection(actor.userId, organizationId, subtree,
        copyTitle(subtree.root.title, maxCollectionTitleCodePoints), copies, request.id);
      if (result === null || result === "changed") {
        await Promise.all([...copies.values()].map((copy) => storage.remove(copy.sourceUri)));
        if (result === null) return notFound(reply, request);
        return reply.code(409).send(safeError("PRIVATE_TREE_CHANGED", "This collection changed. Refresh and try again.", request.id));
      }
      return noStore(reply).code(201).send({
        collection: representCollection(result.collection),
        collections: result.collections.map(representCollection),
        notes: result.notes.map(representNoteSummary),
      });
    } catch (error) { return failed(reply, request, error, "collection duplicate"); }
  });

  app.post<{ Params: { organizationId: string; draftId: string } }>(`${base}/drafts/:draftId/trash`, {
    schema: { params: params("draftId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const entry = await store.trashNote(actor.userId, request.params.organizationId, request.params.draftId, request.id);
      if (!entry) return notFound(reply, request);
      return noStore(reply).send(representTrashEntry(entry));
    } catch (error) { return failed(reply, request, error, "note trash"); }
  });

  app.post<{ Params: { organizationId: string; collectionId: string } }>(`${base}/collections/:collectionId/trash`, {
    schema: { params: params("collectionId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const entry = await store.trashCollection(actor.userId, request.params.organizationId, request.params.collectionId, request.id);
      if (!entry) return notFound(reply, request);
      return noStore(reply).send(representTrashEntry(entry));
    } catch (error) { return failed(reply, request, error, "collection trash"); }
  });

  app.get<{ Params: { organizationId: string } }>(`${base}/trash`, { schema: { params: params() } }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const entries = await store.listTrash(actor.userId, request.params.organizationId);
      if (!entries) return notFound(reply, request);
      return noStore(reply).send({ items: entries.map(representTrashEntry) });
    } catch (error) { return failed(reply, request, error, "trash list"); }
  });

  app.post<{ Params: { organizationId: string; batchId: string } }>(`${base}/trash/:batchId/restore`, {
    schema: { params: params("batchId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const restored = await store.restoreTrash(actor.userId, request.params.organizationId, request.params.batchId, request.id);
      if (!restored) return notFound(reply, request);
      return noStore(reply).send({
        collections: restored.collections.map(representCollection),
        notes: restored.notes.map(representNoteSummary),
      });
    } catch (error) { return failed(reply, request, error, "trash restore"); }
  });

  app.post<{ Params: { organizationId: string; batchId: string } }>(`${base}/trash/:batchId/purge`, {
    schema: { params: params("batchId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    const { organizationId, batchId } = request.params;
    let content;
    try {
      content = await store.purgeTrash(actor.userId, organizationId, batchId, request.id);
      if (!content) return notFound(reply, request);
    } catch (error) { return failed(reply, request, error, "trash purge"); }
    // The tombstones are committed. Content erasure failures are retried by the hourly retention run.
    try {
      const erased = await erasePurgedContent(storage, content, request.log);
      await store.markContentPurged(actor.userId, organizationId, erased);
    } catch (error) {
      request.log.error({ errorType: error instanceof Error ? error.name : "UnknownError", requestId: request.id },
        "Private content erasure bookkeeping failed; it will be retried");
    }
    return reply.code(204).send();
  });
}

async function copyContent(storage: PrivateContentStorage, source: PrivateNoteSource): Promise<{ body: string; copy: StoredContentFields }> {
  if (source.mimeType === "application/pdf") {
    const bytes = await storage.readPdf(source.sourceUri, source.contentHash);
    const copy = await storage.writePdf(bytes);
    return { body: "", copy };
  }
  const body = await storage.read(source.sourceUri, source.contentHash);
  return { body, copy: await storage.write(body) };
}

function safeError(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}
