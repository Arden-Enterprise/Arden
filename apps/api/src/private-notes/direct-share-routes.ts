import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrivateContentStorage } from "./content-storage.js";
import type { DirectShareStore, OwnerShares, SharedItemSummary } from "./direct-share-store.js";

type RequestActor = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;

/** A share request names at most this many people at once; the organization limit applies on top. */
const maxRecipientsPerRequest = 100;

function representShares(shares: OwnerShares) {
  return {
    enabled: shares.settings.enabled, recipientLimit: shares.settings.recipientLimit,
    recipients: shares.recipients.map((recipient) => ({
      shareId: recipient.shareId, membershipId: recipient.membershipId, name: recipient.name,
      email: recipient.email, active: recipient.active, sharedAt: recipient.sharedAt.toISOString(),
    })),
  };
}

function representSharedItem(item: SharedItemSummary) {
  return { id: item.id, title: item.title, kind: item.kind, ownerName: item.ownerName,
    sharedAt: item.sharedAt.toISOString(), updatedAt: item.updatedAt.toISOString(), reviewed: false };
}

/**
 * Decision 0034 (spec F03-SHR) routes. Owners share and revoke under `private-workspace`; recipients read under
 * `shared-with-me`; every member reads the organization setting and only an Organization Admin changes it.
 */
export function registerDirectShareRoutes(app: FastifyInstance, input: {
  store: DirectShareStore;
  storage: PrivateContentStorage;
  requestActor: RequestActor;
  uuidPattern: string;
}) {
  const { store, storage, requestActor, uuidPattern } = input;
  const organization = "/api/v1/organizations/:organizationId";
  const owned = `${organization}/private-workspace/drafts/:draftId/shares`;
  const uuid = { type: "string", pattern: uuidPattern } as const;
  const params = (...names: string[]) => ({
    type: "object", required: ["organizationId", ...names],
    properties: Object.fromEntries(["organizationId", ...names].map((name) => [name, uuid])),
  });
  const error = (reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) =>
    reply.code(status).send({ error: { code, message, requestId: request.id } });
  const notFound = (reply: FastifyReply, request: FastifyRequest) =>
    error(reply, request, 404, "RESOURCE_NOT_AVAILABLE", "This resource is not available.");
  const failed = (reply: FastifyReply, request: FastifyRequest, cause: unknown, operation: string) => {
    request.log.error({ errorType: cause instanceof Error ? cause.name : "UnknownError", requestId: request.id }, `Direct share ${operation} failed`);
    return error(reply, request, 500, "INTERNAL_ERROR", "The request could not be completed.");
  };
  const noStore = (reply: FastifyReply) => reply.header("Cache-Control", "no-store");

  app.get<{ Params: { organizationId: string; draftId: string } }>(owned, { schema: { params: params("draftId") } }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const shares = await store.listShares(actor.userId, request.params.organizationId, request.params.draftId);
      return shares ? noStore(reply).send(representShares(shares)) : notFound(reply, request);
    } catch (cause) { return failed(reply, request, cause, "list"); }
  });

  app.post<{ Params: { organizationId: string; draftId: string }; Body: { recipientMembershipIds: string[] } }>(owned, {
    schema: { params: params("draftId"), body: { type: "object", additionalProperties: false, required: ["recipientMembershipIds"],
      properties: { recipientMembershipIds: { type: "array", minItems: 1, maxItems: maxRecipientsPerRequest, items: uuid } } } },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const result = await store.share(actor.userId, request.params.organizationId, request.params.draftId,
        request.body.recipientMembershipIds, request.id);
      switch (result.kind) {
        case "not-found": return notFound(reply, request);
        case "disabled": return error(reply, request, 409, "DIRECT_SHARING_DISABLED",
          "Sharing with people is turned off for this organization. Contribute a copy to share it.");
        case "invalid-recipients": return error(reply, request, 400, "INVALID_RECIPIENTS",
          "Choose active members of this organization other than yourself.");
        case "limit": return error(reply, request, 409, "DIRECT_SHARE_LIMIT",
          `This item can be shared with up to ${result.limit} people. Contribute a copy to reach more people.`);
        case "shared": return noStore(reply).code(result.added ? 201 : 200).send(representShares(result.shares));
      }
    } catch (cause) { return failed(reply, request, cause, "creation"); }
  });

  app.post<{ Params: { organizationId: string; draftId: string; shareId: string } }>(`${owned}/:shareId/revoke`, {
    schema: { params: params("draftId", "shareId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const shares = await store.revoke(actor.userId, request.params.organizationId, request.params.draftId, request.params.shareId, request.id);
      return shares ? noStore(reply).send(representShares(shares)) : notFound(reply, request);
    } catch (cause) { return failed(reply, request, cause, "revocation"); }
  });

  app.post<{ Params: { organizationId: string; draftId: string } }>(`${owned}/revoke-all`, {
    schema: { params: params("draftId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const shares = await store.revoke(actor.userId, request.params.organizationId, request.params.draftId, null, request.id);
      return shares ? noStore(reply).send(representShares(shares)) : notFound(reply, request);
    } catch (cause) { return failed(reply, request, cause, "revocation"); }
  });

  app.get<{ Params: { organizationId: string } }>(`${organization}/shared-with-me`, { schema: { params: params() } }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const items = await store.listSharedWithMe(actor.userId, request.params.organizationId);
      return items ? noStore(reply).send({ items: items.map(representSharedItem) }) : notFound(reply, request);
    } catch (cause) { return failed(reply, request, cause, "list"); }
  });

  app.get<{ Params: { organizationId: string; draftId: string } }>(`${organization}/shared-with-me/:draftId`, {
    schema: { params: params("draftId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const item = await store.getSharedItem(actor.userId, request.params.organizationId, request.params.draftId);
      if (!item) return notFound(reply, request);
      // The recipient sees the owner's current saved text; a PDF's file is read separately.
      const body = item.mimeType === "text/plain" ? await storage.read(item.sourceUri, item.contentHash) : "";
      return noStore(reply).send({ ...representSharedItem(item), version: item.version, body });
    } catch (cause) { return failed(reply, request, cause, "read"); }
  });

  app.get<{ Params: { organizationId: string; draftId: string } }>(`${organization}/shared-with-me/:draftId/pdf`, {
    schema: { params: params("draftId") },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const item = await store.getSharedItem(actor.userId, request.params.organizationId, request.params.draftId);
      if (!item || item.mimeType !== "application/pdf") return notFound(reply, request);
      const bytes = await storage.readPdf(item.sourceUri, item.contentHash);
      return noStore(reply).send({ id: item.id, version: item.version, pdfBase64: bytes.toString("base64") });
    } catch (cause) { return failed(reply, request, cause, "file read"); }
  });

  app.get<{ Params: { organizationId: string } }>(`${organization}/direct-sharing`, { schema: { params: params() } }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const settings = await store.settings(actor.userId, request.params.organizationId);
      return settings ? noStore(reply).send(settings) : notFound(reply, request);
    } catch (cause) { return failed(reply, request, cause, "settings read"); }
  });

  app.put<{ Params: { organizationId: string }; Body: { enabled: boolean; recipientLimit: number } }>(`${organization}/direct-sharing`, {
    schema: { params: params(), body: { type: "object", additionalProperties: false, required: ["enabled", "recipientLimit"],
      properties: { enabled: { type: "boolean" }, recipientLimit: { type: "integer", minimum: 1, maximum: 100 } } } },
  }, async (request, reply) => {
    const actor = await requestActor(request, reply);
    if (!actor) return;
    try {
      const settings = await store.updateSettings(actor.userId, request.params.organizationId, request.body, request.id);
      return settings ? noStore(reply).send(settings) : notFound(reply, request);
    } catch (cause) { return failed(reply, request, cause, "settings update"); }
  });
}
