import { describe, expect, it } from "vitest";
import { parseCollectionLegacyPlan, validateCollectionLegacyPlan, type CollectionLegacyInventory, type CollectionLegacyPlan } from "./collection-legacy.js";
import { assertCollectionRehearsalTarget } from "./collection-legacy-cli.js";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", folder = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const doc = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", publication = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function fixture(): { inventory: CollectionLegacyInventory; plan: CollectionLegacyPlan } {
  return { inventory: { organizationId: org, fingerprint: "a".repeat(64), retainedTopics: 1,
    collections: [{ id: folder, status: "ACTIVE", version: 1, allowedTypes: null }], placements: [],
    links: [{ collectionId: folder, publicationId: publication, documentId: doc, sourceOrganizationId: org,
      currentPublicationId: publication, common: true, type: "Guide" }] },
  plan: { organizationId: org, fingerprint: "a".repeat(64), collections: [{ id: folder, allowedTypes: ["Guide"] }],
    documents: [{ documentId: doc, collectionId: folder }] } };
}

describe("explicit Collection legacy plans", () => {
  it("accepts reviewed single-folder or deliberate Unassigned without guessing", () => {
    const { inventory, plan } = fixture();
    expect(parseCollectionLegacyPlan(plan)).toEqual(plan);
    expect(() => validateCollectionLegacyPlan(inventory, plan)).not.toThrow();
    plan.documents[0]!.collectionId = null;
    expect(() => validateCollectionLegacyPlan(inventory, plan)).not.toThrow();
    // A newer valid location may be outside all historical exact-version links.
    inventory.collections.push({ id: publication, status: "ACTIVE", version: 2, allowedTypes: ["Guide"] });
    inventory.placements.push({ documentId: doc, collectionId: publication, revision: "4" });
    plan.documents[0]!.collectionId = publication;
    expect(() => validateCollectionLegacyPlan(inventory, plan)).not.toThrow();
  });
  it("refuses stale, partial, duplicate, cross-org and conflicting destinations", () => {
    for (const change of ["stale", "missing-type", "missing-doc", "duplicate", "foreign", "restricted", "wrong-type", "existing"] as const) {
      const { inventory, plan } = fixture();
      if (change === "stale") plan.fingerprint = "b".repeat(64);
      if (change === "missing-type") plan.collections = [];
      if (change === "missing-doc") plan.documents = [];
      if (change === "duplicate") plan.documents.push(plan.documents[0]!);
      if (change === "foreign") inventory.links[0]!.sourceOrganizationId = doc;
      if (change === "restricted") inventory.links[0]!.common = false;
      if (change === "wrong-type") inventory.links[0]!.type = "Procedure";
      if (change === "existing") inventory.placements.push({ documentId: doc, collectionId: null, revision: "5" });
      expect(() => validateCollectionLegacyPlan(inventory, plan), change).toThrow();
    }
  });
  it.each([null, {}, { organizationId: org, fingerprint: "a".repeat(64), collections: [], documents: [], dropTables: true },
    { organizationId: org, fingerprint: "a".repeat(64), collections: [{ id: folder, allowedTypes: ["Unknown"] }], documents: [] }])(
    "rejects untrusted plan shape %j", value => { expect(() => parseCollectionLegacyPlan(value)).toThrow(); });
  it("permits only loopback disposable CLI targets and never production", () => {
    expect(() => assertCollectionRehearsalTarget("postgresql://local:demo@127.0.0.1:55439/arden_test_qa", "test")).not.toThrow();
    for (const url of ["postgresql://remote/arden_test_qa", "postgresql://localhost/staging", "postgresql://localhost/arden_test_qa?sslmode=disable"])
      expect(() => assertCollectionRehearsalTarget(url, "test")).toThrow();
    expect(() => assertCollectionRehearsalTarget("postgresql://localhost/arden_test_qa", "production")).toThrow();
  });
});
