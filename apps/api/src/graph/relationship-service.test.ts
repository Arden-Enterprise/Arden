import { createHash } from "node:crypto";
import Fastify, { type FastifyError } from "fastify";
import { describe, expect, it } from "vitest";
import type { DocumentId, GraphRelationshipEdge } from "@arden/domain";
import { buildApp } from "../app.js";
import type { ArdenDataRepository } from "../db/repository.js";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import { registerGraphRoutes } from "./graph-routes.js";
import {
  DocumentRelationshipService,
  type DocumentRelationshipStore,
  type RelationshipAuditRecord,
  type RelationshipIdempotencyRecord,
  type RelationshipTx,
  type StoredRelationshipRow,
} from "./relationship-service.js";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrgId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const authorUserId = "11111111-1111-4111-8111-111111111111";
const adminUserId = "22222222-2222-4222-8222-222222222222";
const readerUserId = "33333333-3333-4333-8333-333333333333";
const authorMembershipId = "44444444-4444-4444-8444-444444444444";
const adminMembershipId = "55555555-5555-4555-8555-555555555555";
const readerMembershipId = "66666666-6666-4666-8666-666666666666";
const docA = "77777777-7777-4777-8777-777777777771";
const docB = "77777777-7777-4777-8777-777777777772";
const docC = "77777777-7777-4777-8777-777777777773";
const docRestricted = "77777777-7777-4777-8777-777777777774";
const docExpired = "77777777-7777-4777-8777-777777777775";
const idemKey1 = "88888888-8888-4888-8888-888888888881";
const idemKey2 = "88888888-8888-4888-8888-888888888882";
const idemKey3 = "88888888-8888-4888-8888-888888888883";
const relId1 = "99999999-9999-4999-8999-000000000001";
const relId2 = "99999999-9999-4999-8999-000000000002";
const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

class FakePgError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly constraint?: string,
  ) {
    super(message);
  }
}

class FakeRelationshipStore implements DocumentRelationshipStore {
  memberships = new Map<string, string>([
    [`${authorUserId}:${orgId}`, authorMembershipId],
    [`${adminUserId}:${orgId}`, adminMembershipId],
    [`${readerUserId}:${orgId}`, readerMembershipId],
  ]);

  managedSources = new Map<string, Set<string>>([
    [authorMembershipId, new Set([docA, docB, docC, docExpired])],
    [adminMembershipId, new Set([docA, docB, docC, docRestricted, docExpired])],
    [readerMembershipId, new Set()],
  ]);

  readableDocs = new Map<string, Set<string>>([
    [authorMembershipId, new Set([docA, docB, docC])],
    [adminMembershipId, new Set([docA, docB, docC])],
    [readerMembershipId, new Set([docA, docB, docC])],
  ]);

  relationships: StoredRelationshipRow[] = [];
  idempotency = new Map<string, RelationshipIdempotencyRecord>();
  audits: RelationshipAuditRecord[] = [];
  locks: string[] = [];
  nextRelCounter = 0;
  forceInsertError: FakePgError | null = null;

  private idemKey(organizationId: string, membershipId: string, key: string): string {
    return `${organizationId}:${membershipId}:${key}`;
  }

  private nextRelationshipId(): string {
    this.nextRelCounter += 1;
    return `99999999-9999-4999-8999-${String(this.nextRelCounter).padStart(12, "0")}`;
  }

  private hasSupersedesPath(organizationId: string, start: string, target: string): boolean {
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const rel of this.relationships) {
        if (rel.organizationId === organizationId && rel.relationshipType === "SUPERSEDES" && rel.sourceDocumentId === current) {
          queue.push(rel.targetDocumentId);
        }
      }
    }
    return false;
  }

  async withTransaction<T>(
    userId: string,
    organizationId: string,
    work: (tx: RelationshipTx) => Promise<T>,
  ): Promise<T> {
    const relSnapshot = this.relationships.map((row) => ({ ...row }));
    const idemSnapshot = new Map(this.idempotency);
    const auditSnapshot = [...this.audits];
    const membershipId = this.memberships.get(`${userId}:${organizationId}`) ?? null;

    const tx: RelationshipTx = {
      resolveActiveMembership: async () => membershipId,
      lockIdempotencyKey: async (actorMembershipId, key) => {
        this.locks.push(`${organizationId}:${actorMembershipId}:${key}`);
      },
      findIdempotency: async (actorMembershipId, key) =>
        this.idempotency.get(this.idemKey(organizationId, actorMembershipId, key)) ?? null,
      saveIdempotency: async (record) => {
        const k = this.idemKey(organizationId, record.actorMembershipId, record.idempotencyKey);
        if (this.idempotency.has(k)) {
          throw new FakePgError("duplicate key", "23505", "document_relationship_idempotency_pkey");
        }
        this.idempotency.set(k, { ...record, responseJson: structuredClone(record.responseJson) });
      },
      canCreateRelationship: async (sourceDocumentId, targetDocumentId) => {
        if (!membershipId) return false;
        const canManage = this.managedSources.get(membershipId)?.has(sourceDocumentId) === true;
        const readable = this.readableDocs.get(membershipId);
        return canManage && readable?.has(sourceDocumentId) === true && readable?.has(targetDocumentId) === true;
      },
      insertRelationship: async (input) => {
        if (this.forceInsertError) throw this.forceInsertError;
        if (!membershipId || input.createdByMembershipId !== membershipId) {
          throw new FakePgError("RLS denied", "42501");
        }
        if (input.sourceDocumentId === input.targetDocumentId) {
          throw new FakePgError("self link", "23514", "ck_document_relationship_not_self");
        }
        const canManage = this.managedSources.get(membershipId)?.has(input.sourceDocumentId) === true;
        const readable = this.readableDocs.get(membershipId);
        if (!canManage || !readable?.has(input.sourceDocumentId) || !readable?.has(input.targetDocumentId)) {
          throw new FakePgError("RLS denied", "42501");
        }
        if (this.relationships.some((r) =>
          r.organizationId === organizationId
          && r.sourceDocumentId === input.sourceDocumentId
          && r.targetDocumentId === input.targetDocumentId
          && r.relationshipType === input.relationshipType)) {
          throw new FakePgError("duplicate", "23505", "uq_document_relationship");
        }
        if (input.relationshipType === "RELATED" && this.relationships.some((r) =>
          r.organizationId === organizationId
          && r.sourceDocumentId === input.targetDocumentId
          && r.targetDocumentId === input.sourceDocumentId
          && r.relationshipType === "RELATED")) {
          throw new FakePgError("symmetric related", "23505", "uq_document_relationship_symmetric_related");
        }
        if (input.relationshipType === "SUPERSEDES"
          && this.hasSupersedesPath(organizationId, input.targetDocumentId, input.sourceDocumentId)) {
          throw new FakePgError("cycle", "23514", "ck_document_relationship_supersedes_acyclic");
        }
        const created: StoredRelationshipRow = {
          relationshipId: this.nextRelationshipId(),
          organizationId,
          sourceDocumentId: input.sourceDocumentId,
          targetDocumentId: input.targetDocumentId,
          relationshipType: input.relationshipType,
          createdByMembershipId: input.createdByMembershipId,
          createdAt: new Date("2026-11-26T12:00:00.000Z"),
        };
        this.relationships.push(created);
        return created;
      },
      removeRelationship: async (sourceDocumentId, relationshipId) => {
        if (!membershipId) return null;
        if (this.managedSources.get(membershipId)?.has(sourceDocumentId) !== true) return null;
        const idx = this.relationships.findIndex((r) =>
          r.organizationId === organizationId
          && r.sourceDocumentId === sourceDocumentId
          && r.relationshipId === relationshipId);
        if (idx === -1) return null;
        const [removed] = this.relationships.splice(idx, 1);
        return removed!;
      },
      writeAuditEvent: async (record) => {
        this.audits.push({ ...record, details: { ...record.details } });
      },
    };

    try {
      return await work(tx);
    } catch (error) {
      this.relationships = relSnapshot;
      this.idempotency = idemSnapshot;
      this.audits = auditSnapshot;
      throw error;
    }
  }
}

describe("DocumentRelationshipService", () => {
  it("creates a governed relationship, writes ADR 0035 ID-only audit details, and replays idempotently", async () => {
    const store = new FakeRelationshipStore();
    const service = new DocumentRelationshipService(store);

    const created = await service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docB, relationshipType: "REFERENCES" },
      idemKey1,
    );
    expect(created).toEqual({
      kind: "created",
      statusCode: 201,
      edge: {
        relationshipId: relId1,
        sourceDocumentId: docA as DocumentId,
        targetDocumentId: docB as DocumentId,
        relationshipType: "REFERENCES",
        createdAt: "2026-11-26T12:00:00.000Z",
      },
    });
    expect(store.locks).toEqual([`${orgId}:${authorMembershipId}:${idemKey1}`]);
    expect(store.audits).toEqual([
      {
        organizationId: orgId,
        actorMembershipId: authorMembershipId,
        eventType: "DOCUMENT_RELATIONSHIP_CREATED",
        outcome: "SUCCESS",
        details: {
          relationshipId: relId1,
          sourceDocumentId: docA,
          targetDocumentId: docB,
          relationshipType: "REFERENCES",
        },
      },
    ]);
    // Verify canonical SHA-256 request hash in idempotency ledger.
    const expectedHash = createHash("sha256")
      .update(JSON.stringify({
        op: "CREATE",
        sourceDocumentId: docA,
        targetDocumentId: docB,
        relationshipType: "REFERENCES",
      }))
      .digest("hex");
    expect(store.idempotency.get(`${orgId}:${authorMembershipId}:${idemKey1}`)?.requestHash).toBe(expectedHash);

    // Same key + same payload replays stored 201 + edge without writing a second audit event.
    const replay = await service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docB, relationshipType: "REFERENCES" },
      idemKey1,
    );
    expect(replay).toEqual({
      kind: "replayed",
      statusCode: 201,
      response: created.kind === "created" ? created.edge : null,
    });
    expect(store.audits).toHaveLength(1);
    expect(store.relationships).toHaveLength(1);

    // Same key + different payload returns 409 IDEMPOTENCY_CONFLICT.
    const conflict = await service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docC, relationshipType: "REFERENCES" },
      idemKey1,
    );
    expect(conflict).toEqual({ kind: "idempotency-conflict" });

    // Reusing a CREATE key on REMOVE also returns 409 IDEMPOTENCY_CONFLICT.
    const crossOpConflict = await service.removeRelationship(authorUserId, orgId, docA, relId1, idemKey1);
    expect(crossOpConflict).toEqual({ kind: "idempotency-conflict" });
  });

  it.each(["endpoint readership", "source authority"])("reauthorizes a create replay after losing %s", async (permission) => {
    const store = new FakeRelationshipStore();
    const service = new DocumentRelationshipService(store);
    const create = () => service.createRelationship(
      authorUserId, orgId, docA, { targetDocumentId: docB, relationshipType: "REFERENCES" }, idemKey1,
    );

    expect(await create()).toMatchObject({ kind: "created" });
    if (permission === "endpoint readership") store.readableDocs.get(authorMembershipId)!.delete(docB);
    else store.managedSources.get(authorMembershipId)!.delete(docA);

    expect(await create()).toEqual({ kind: "not-available" });
    expect(store.audits).toHaveLength(1);
    expect(store.relationships).toHaveLength(1);
  });

  it("rejects self-links with invalid-request and maps non-member/unauthorized/unreadable targets uniformly to not-available", async () => {
    const store = new FakeRelationshipStore();
    const service = new DocumentRelationshipService(store);

    // Non-member -> uniform 404.
    await expect(service.createRelationship(
      authorUserId,
      otherOrgId,
      docA,
      { targetDocumentId: docB, relationshipType: "RELATED" },
      idemKey1,
    )).resolves.toEqual({ kind: "not-available" });

    // Self-link -> 400 INVALID_REQUEST (does not burn idempotency key).
    await expect(service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docA, relationshipType: "RELATED" },
      idemKey1,
    )).resolves.toMatchObject({ kind: "invalid-request" });
    expect(store.idempotency.size).toBe(0);

    // Ordinary reader (can read both, manages neither) -> uniform 404.
    await expect(service.createRelationship(
      readerUserId,
      orgId,
      docA,
      { targetDocumentId: docB, relationshipType: "REFERENCES" },
      idemKey1,
    )).resolves.toEqual({ kind: "not-available" });

    // Org Admin probing unreadable restricted target -> uniform 404.
    await expect(service.createRelationship(
      adminUserId,
      orgId,
      docA,
      { targetDocumentId: docRestricted, relationshipType: "REFERENCES" },
      idemKey1,
    )).resolves.toEqual({ kind: "not-available" });

    // Author linking to expired target -> uniform 404.
    await expect(service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docExpired, relationshipType: "REFERENCES" },
      idemKey1,
    )).resolves.toEqual({ kind: "not-available" });

    // Database 42501 / 23503 errors on INSERT also map uniformly to not-available.
    store.forceInsertError = new FakePgError("rls", "42501");
    await expect(service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docB, relationshipType: "REFERENCES" },
      idemKey1,
    )).resolves.toEqual({ kind: "not-available" });

    store.forceInsertError = new FakePgError("fk", "23503");
    await expect(service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docB, relationshipType: "REFERENCES" },
      idemKey1,
    )).resolves.toEqual({ kind: "not-available" });
  });

  it("maps duplicate, symmetric RELATED, and SUPERSEDES cycle violations to 409 outcomes", async () => {
    const store = new FakeRelationshipStore();
    const service = new DocumentRelationshipService(store);

    const first = await service.createRelationship(
      authorUserId,
      orgId,
      docA,
      { targetDocumentId: docB, relationshipType: "RELATED" },
      idemKey1,
    );
    expect(first.kind).toBe("created");

    // Reverse RELATED with a fresh key -> 409 RELATIONSHIP_EXISTS.
    await expect(service.createRelationship(
      authorUserId,
      orgId,
      docB,
      { targetDocumentId: docA, relationshipType: "RELATED" },
      idemKey2,
    )).resolves.toEqual({ kind: "relationship-exists" });

    // SUPERSEDES chain A -> B -> C, then C -> A -> 409 RELATIONSHIP_CYCLE.
    await expect(service.createRelationship(
      adminUserId,
      orgId,
      docA,
      { targetDocumentId: docB, relationshipType: "SUPERSEDES" },
      "88888888-8888-4888-8888-888888888811",
    )).resolves.toMatchObject({ kind: "created" });
    await expect(service.createRelationship(
      adminUserId,
      orgId,
      docB,
      { targetDocumentId: docC, relationshipType: "SUPERSEDES" },
      "88888888-8888-4888-8888-888888888812",
    )).resolves.toMatchObject({ kind: "created" });
    await expect(service.createRelationship(
      adminUserId,
      orgId,
      docC,
      { targetDocumentId: docA, relationshipType: "SUPERSEDES" },
      "88888888-8888-4888-8888-888888888813",
    )).resolves.toEqual({ kind: "relationship-cycle" });
  });

  it("removes ghost edges even when target is unreadable, replays after deletion, and writes ADR 0035 delete audit", async () => {
    const store = new FakeRelationshipStore();
    store.relationships.push({
      relationshipId: relId2,
      organizationId: orgId,
      sourceDocumentId: docA,
      targetDocumentId: docRestricted,
      relationshipType: "REFERENCES",
      createdByMembershipId: authorMembershipId,
      createdAt: new Date("2026-11-20T12:00:00.000Z"),
    });
    const service = new DocumentRelationshipService(store);

    // Ordinary reader cannot remove -> 404.
    await expect(service.removeRelationship(readerUserId, orgId, docA, relId2, idemKey1))
      .resolves.toEqual({ kind: "not-available" });
    expect(store.relationships).toHaveLength(1);

    // Author removes ghost edge even though docRestricted is unreadable to author.
    const removed = await service.removeRelationship(authorUserId, orgId, docA, relId2, idemKey2);
    expect(removed).toEqual({
      kind: "removed",
      statusCode: 200,
      response: { removed: true },
    });
    expect(store.relationships).toHaveLength(0);
    expect(store.audits).toEqual([
      {
        organizationId: orgId,
        actorMembershipId: authorMembershipId,
        eventType: "DOCUMENT_RELATIONSHIP_DELETED",
        outcome: "SUCCESS",
        details: {
          relationshipId: relId2,
          sourceDocumentId: docA,
          targetDocumentId: docRestricted,
          relationshipType: "REFERENCES",
        },
      },
    ]);

    // Replay after deletion STILL succeeds with 200 { removed: true } and writes no second audit row!
    const replay = await service.removeRelationship(authorUserId, orgId, docA, relId2, idemKey2);
    expect(replay).toEqual({
      kind: "replayed",
      statusCode: 200,
      response: { removed: true },
    });
    expect(store.audits).toHaveLength(1);

    // Same key with a different relationshipId -> 409 IDEMPOTENCY_CONFLICT.
    await expect(service.removeRelationship(authorUserId, orgId, docA, relId1, idemKey2))
      .resolves.toEqual({ kind: "idempotency-conflict" });

    // Fresh key after deletion -> 404 RESOURCE_NOT_AVAILABLE.
    await expect(service.removeRelationship(authorUserId, orgId, docA, relId2, idemKey3))
      .resolves.toEqual({ kind: "not-available" });
  });
});

describe("registerGraphRoutes — relationship endpoints", () => {
  function buildTestApp(
    relationshipService: DocumentRelationshipService | undefined,
    actorUserId = authorUserId,
    authenticated = true,
  ) {
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (error.validation) {
        return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "The request is invalid.", requestId: request.id } });
      }
      return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", requestId: request.id } });
    });
    registerGraphRoutes(app, {
      relationshipService,
      uuidPattern,
      requestActor: async (_request, reply) => {
        if (!authenticated) {
          reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } });
          return null;
        }
        return { userId: actorUserId };
      },
    });
    return app;
  }

  it("validates headers/body strictly, sets Cache-Control: no-store, and maps create/remove status codes accurately", async () => {
    const store = new FakeRelationshipStore();
    const service = new DocumentRelationshipService(store);
    const app = buildTestApp(service);
    const createUrl = `/api/v1/organizations/${orgId}/knowledge/documents/${docA}/relationships`;

    // Missing or invalid Idempotency-Key -> 400 INVALID_REQUEST.
    for (const headers of [
      {},
      { "idempotency-key": "not-a-uuid" },
    ]) {
      const bad = await app.inject({
        method: "POST",
        url: createUrl,
        headers,
        payload: { targetDocumentId: docB, relationshipType: "REFERENCES" },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe("INVALID_REQUEST");
    }

    // Extra body properties or invalid relationshipType -> 400.
    for (const payload of [
      { targetDocumentId: docB, relationshipType: "REFERENCES", extra: true },
      { targetDocumentId: docB, relationshipType: "PARENT" },
      { targetDocumentId: "not-a-uuid", relationshipType: "REFERENCES" },
      {},
    ]) {
      const bad = await app.inject({
        method: "POST",
        url: createUrl,
        headers: { "idempotency-key": idemKey1 },
        payload,
      });
      expect(bad.statusCode).toBe(400);
    }

    // Valid create -> 201 + Cache-Control: no-store + GraphRelationshipEdge.
    const created = await app.inject({
      method: "POST",
      url: createUrl,
      headers: { "idempotency-key": idemKey1 },
      payload: { targetDocumentId: docB, relationshipType: "RELATED" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    const edge = created.json() as GraphRelationshipEdge;
    expect(edge).toMatchObject({
      relationshipId: relId1,
      sourceDocumentId: docA,
      targetDocumentId: docB,
      relationshipType: "RELATED",
    });

    // Idempotent replay -> 201 with identical edge.
    const replay = await app.inject({
      method: "POST",
      url: createUrl,
      headers: { "idempotency-key": idemKey1 },
      payload: { targetDocumentId: docB, relationshipType: "RELATED" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["cache-control"]).toBe("no-store");
    expect(replay.json()).toEqual(edge);

    // Mismatched payload with same key -> 409 IDEMPOTENCY_CONFLICT.
    const idemConflict = await app.inject({
      method: "POST",
      url: createUrl,
      headers: { "idempotency-key": idemKey1 },
      payload: { targetDocumentId: docC, relationshipType: "RELATED" },
    });
    expect(idemConflict.statusCode).toBe(409);
    expect(idemConflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    // Self-link -> 400 INVALID_REQUEST.
    const selfLink = await app.inject({
      method: "POST",
      url: createUrl,
      headers: { "idempotency-key": idemKey2 },
      payload: { targetDocumentId: docA, relationshipType: "REFERENCES" },
    });
    expect(selfLink.statusCode).toBe(400);
    expect(selfLink.json().error.code).toBe("INVALID_REQUEST");

    // Symmetric RELATED duplicate -> 409 RELATIONSHIP_EXISTS.
    const reverseDup = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/knowledge/documents/${docB}/relationships`,
      headers: { "idempotency-key": idemKey2 },
      payload: { targetDocumentId: docA, relationshipType: "RELATED" },
    });
    expect(reverseDup.statusCode).toBe(409);
    expect(reverseDup.json().error.code).toBe("RELATIONSHIP_EXISTS");

    // SUPERSEDES cycle -> 409 RELATIONSHIP_CYCLE.
    await app.inject({
      method: "POST",
      url: createUrl,
      headers: { "idempotency-key": "88888888-8888-4888-8888-888888888821" },
      payload: { targetDocumentId: docB, relationshipType: "SUPERSEDES" },
    });
    const cycle = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/knowledge/documents/${docB}/relationships`,
      headers: { "idempotency-key": "88888888-8888-4888-8888-888888888822" },
      payload: { targetDocumentId: docA, relationshipType: "SUPERSEDES" },
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().error.code).toBe("RELATIONSHIP_CYCLE");

    // Unreadable target -> uniform 404 RESOURCE_NOT_AVAILABLE.
    const restricted = await app.inject({
      method: "POST",
      url: createUrl,
      headers: { "idempotency-key": "88888888-8888-4888-8888-888888888823" },
      payload: { targetDocumentId: docRestricted, relationshipType: "REFERENCES" },
    });
    expect(restricted.statusCode).toBe(404);
    expect(restricted.json().error.code).toBe("RESOURCE_NOT_AVAILABLE");

    // Remove route rejects non-empty body and missing Idempotency-Key -> 400.
    const removeUrl = `/api/v1/organizations/${orgId}/knowledge/documents/${docA}/relationships/${relId1}/remove`;
    const badRemoveBody = await app.inject({
      method: "POST",
      url: removeUrl,
      headers: { "idempotency-key": idemKey3 },
      payload: { force: true },
    });
    expect(badRemoveBody.statusCode).toBe(400);

    const badRemoveKey = await app.inject({
      method: "POST",
      url: removeUrl,
      payload: {},
    });
    expect(badRemoveKey.statusCode).toBe(400);

    // Valid remove -> 200 { removed: true } + Cache-Control: no-store.
    const removed = await app.inject({
      method: "POST",
      url: removeUrl,
      headers: { "idempotency-key": idemKey3 },
      payload: {},
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.headers["cache-control"]).toBe("no-store");
    expect(removed.json()).toEqual({ removed: true });

    // Replay remove after deletion -> 200 { removed: true }.
    const removeReplay = await app.inject({
      method: "POST",
      url: removeUrl,
      headers: { "idempotency-key": idemKey3 },
      payload: {},
    });
    expect(removeReplay.statusCode).toBe(200);
    expect(removeReplay.json()).toEqual({ removed: true });

    await app.close();
  });

  it("returns 401 when unauthenticated and 503 when relationshipService is unavailable", async () => {
    const unauthApp = buildTestApp(new DocumentRelationshipService(new FakeRelationshipStore()), authorUserId, false);
    const unauth = await unauthApp.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/knowledge/documents/${docA}/relationships`,
      headers: { "idempotency-key": idemKey1 },
      payload: { targetDocumentId: docB, relationshipType: "REFERENCES" },
    });
    expect(unauth.statusCode).toBe(401);
    await unauthApp.close();

    const unavailableApp = buildTestApp(undefined);
    const create503 = await unavailableApp.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/knowledge/documents/${docA}/relationships`,
      headers: { "idempotency-key": idemKey1 },
      payload: { targetDocumentId: docB, relationshipType: "REFERENCES" },
    });
    expect(create503.statusCode).toBe(503);
    expect(create503.headers["cache-control"]).toBe("no-store");

    const remove503 = await unavailableApp.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/knowledge/documents/${docA}/relationships/${relId1}/remove`,
      headers: { "idempotency-key": idemKey2 },
      payload: {},
    });
    expect(remove503.statusCode).toBe(503);
    expect(remove503.headers["cache-control"]).toBe("no-store");
    await unavailableApp.close();
  });

  it("wires relationship POST routes through buildApp with repository.graphRelationships", async () => {
    const store = new FakeRelationshipStore();
    const fakeRepo = { graphRelationships: store } as unknown as ArdenDataRepository;
    const fakeStorage = {} as unknown as PrivateContentStorage;
    const app = buildApp({
      checkDatabase: async () => undefined,
      auth: null,
      authTrustedOrigins: ["http://localhost:5180"],
      secureCookies: false,
      repository: fakeRepo,
      storage: fakeStorage,
      testActor: { userId: authorUserId, email: "author@example.test", fullName: "Author", emailVerified: true },
    });
    try {
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgId}/knowledge/documents/${docA}/relationships`,
        headers: { origin: "http://localhost:5180", "idempotency-key": idemKey1 },
        payload: { targetDocumentId: docB, relationshipType: "REFERENCES" },
      });
      expect(created.statusCode).toBe(201);
      expect(created.headers["cache-control"]).toBe("no-store");
      const edge = created.json() as GraphRelationshipEdge;
      expect(edge.relationshipId).toBe(relId1);

      const removed = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgId}/knowledge/documents/${docA}/relationships/${edge.relationshipId}/remove`,
        headers: { origin: "http://localhost:5180", "idempotency-key": idemKey2 },
        payload: {},
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.headers["cache-control"]).toBe("no-store");
      expect(removed.json()).toEqual({ removed: true });
    } finally {
      await app.close();
    }
  });
});
