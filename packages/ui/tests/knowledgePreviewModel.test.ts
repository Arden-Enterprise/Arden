import { describe, expect, it } from "vitest";
import { createKnowledgePreview, createSampleHandover, draftReadyForReview, handoverReady, reduceKnowledgePreview } from "../src/knowledge/knowledgePreviewModel";

describe("synthetic knowledge governance preview", () => {
  it("blocks incomplete or private drafts from shared review", () => {
    const initial = createKnowledgePreview();
    expect(draftReadyForReview(initial.draft)).toBe(false);
    const blocked = reduceKnowledgePreview(initial, { type: "submit" });
    expect(blocked.submitted).toBe(initial.submitted);
    const privateDraft = { ...initial.draft, scope: "Private" as const, recoveryReady: true, sourceReady: true };
    expect(draftReadyForReview(privateDraft)).toBe(false);
    expect(draftReadyForReview({ ...privateDraft, scope: "Department", title: " " })).toBe(false);
  });

  it("keeps submitted content independent from later draft edits", () => {
    const initial = createKnowledgePreview();
    const edited = reduceKnowledgePreview(initial, { type: "edit", draft: { ...initial.draft, recoveryReady: true, sourceReady: true } });
    const submitted = reduceKnowledgePreview(edited, { type: "submit" });
    const later = reduceKnowledgePreview(submitted, { type: "edit", draft: { ...submitted.draft, title: "A newer draft", sections: [{ heading: "Changed", body: "Changed body" }] } });
    expect(later.submitted?.draft.title).toBe("API Gateway Runbook");
    expect(later.submitted?.draft.sections).toHaveLength(3);
    expect(later.draft.title).toBe("A newer draft");
  });

  it("automatically publishes the exact snapshot on final approval", () => {
    const initial = createKnowledgePreview();
    const edited = reduceKnowledgePreview(initial, { type: "edit", draft: { ...initial.draft, recoveryReady: true, sourceReady: true } });
    const submitted = reduceKnowledgePreview(edited, { type: "submit" });
    expect(reduceKnowledgePreview(submitted, { type: "approve", version: 24 }).submitted?.decision).toBe("pending");
    const published = reduceKnowledgePreview(submitted, { type: "approve", version: 25 });
    expect(published.submitted?.decision).toBe("approved");
    expect(published.publication?.version).toBe(25);
    expect(published.publication?.draft.title).toBe("API Gateway Runbook");
  });

  it("freezes classification separately from publication audience", () => {
    const initial = createKnowledgePreview();
    const readyDraft = { ...initial.draft, classification: "RESTRICTED" as const, scope: "Department" as const, recoveryReady: true, sourceReady: true };
    let state = reduceKnowledgePreview(initial, { type: "edit", draft: readyDraft });
    state = reduceKnowledgePreview(state, { type: "submit" });
    state = reduceKnowledgePreview(state, { type: "edit", draft: { ...state.draft, classification: "INTERNAL" } });
    expect(state.submitted?.draft.classification).toBe("RESTRICTED");
    expect(state.submitted?.draft.scope).toBe("Department");
    const published = reduceKnowledgePreview(state, { type: "approve", version: 25 });
    expect(published.publication?.draft.classification).toBe("RESTRICTED");
  });

  it("resubmits a revised draft as a new pending snapshot without replacing a publication", () => {
    let state = createKnowledgePreview();
    state = reduceKnowledgePreview(state, { type: "edit", draft: { ...state.draft, recoveryReady: true, sourceReady: true } });
    state = reduceKnowledgePreview(state, { type: "submit" });
    state = reduceKnowledgePreview(state, { type: "approve", version: 25 });
    state = reduceKnowledgePreview(state, { type: "edit", draft: { ...state.draft, title: "New guidance" } });
    state = reduceKnowledgePreview(state, { type: "submit" });
    state = reduceKnowledgePreview(state, { type: "request-revision" });
    expect(state.revisionRequested).toBe(true);
    expect(reduceKnowledgePreview(state, { type: "approve", version: 26 }).submitted?.decision).toBe("revision-requested");
    state = reduceKnowledgePreview(state, { type: "submit" });
    expect(state.submitted?.version).toBe(27);
    expect(state.submitted?.decision).toBe("pending");
    expect(state.revisionRequested).toBe(false);
    expect(state.publication?.version).toBe(25);
    expect(state.publication?.draft.title).toBe("API Gateway Runbook");
  });
});

describe("synthetic shared handover plan", () => {
  it("requires a receiving owner for every transfer and revision", () => {
    const documents = createSampleHandover();
    expect(handoverReady(documents)).toBe(false);
    expect(handoverReady(documents.map((document) => document.id === "sample-cutover" ? { ...document, owner: "Hoa Bui" } : document))).toBe(true);
    expect(handoverReady([])).toBe(false);
    expect(handoverReady(documents.map((document) => ({ ...document, outcome: "transfer", owner: " " })))).toBe(false);
  });
});
