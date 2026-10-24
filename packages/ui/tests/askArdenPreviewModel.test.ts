import { describe, expect, it } from "vitest";
import { disconnectedPreviewMessages, previewMessagesForPrompt, sampleConversation, starterPrompts } from "../src/ask-arden/askArdenPreviewModel";

describe("Ask Arden interface preview", () => {
  it("keeps unconnected prompts honest instead of fabricating retrieval", () => {
    const messages = disconnectedPreviewMessages("  What changed?  ");
    expect(messages[0]).toMatchObject({ role: "member", body: "What changed?" });
    expect(messages[1]?.body).toContain("not connected to retrieval");
    expect(messages[1]?.citations).toBeUndefined();
  });

  it("labels citations only on the sample conversation", () => {
    expect(starterPrompts.length).toBe(3);
    expect(sampleConversation[1]?.citations).toHaveLength(2);
    expect(sampleConversation[1]?.citations?.[0]).toMatchObject({
      documentId: "knowledge-publication-workflow",
      versionId: "publication-workflow-v2-1",
      blockId: "activation-boundary",
    });
    expect(sampleConversation[1]?.citations?.every((citation) => citation.excerpt.length > 20)).toBe(true);
  });

  it("opens the cited sample only for its labelled starter prompt", () => {
    expect(previewMessagesForPrompt(starterPrompts[0])).toBe(sampleConversation);
    expect(previewMessagesForPrompt("Summarize a real policy")[1]?.citations).toBeUndefined();
  });
});
