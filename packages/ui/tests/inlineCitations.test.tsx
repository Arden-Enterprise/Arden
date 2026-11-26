// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyableAnswer, layoutCitedAnswer, type AnswerBlock, type AnswerCitation } from "../src/ask-arden/askArdenModel";
import { CitedAnswer } from "../src/ask-arden/CitedAnswer";
import { KnowledgeDocumentDetail } from "../src/knowledge/KnowledgeDocumentDetail";
import type { KnowledgeNavigationTarget } from "../src/knowledge/knowledgeCitation";

afterEach(cleanup);

const policy = { documentId: "doc-1", versionId: "ver-1", title: "Synthetic Lifecycle Policy", version: "1.0", scope: "Company-wide",
  classification: "INTERNAL" as const };
const access: AnswerCitation = { ...policy, blockId: "b1", page: 1, excerpt: "Managers must request system access five working days before the start date [1]." };
const devices: AnswerCitation = { ...policy, blockId: "b2", page: 1, excerpt: "All company devices must be returned to IT on the last working day." };
const lessons: AnswerCitation = { ...policy, documentId: "doc-2", versionId: "ver-2", title: "Synthetic Handover Lessons",
  blockId: "c1", excerpt: "Unrelated archive retention text." };
const answer = "Request system access five working days before the start date. Return company devices to IT on the last working day.";

/** Every sentence of a laid-out answer, in reading order. */
function sentencesOf(blocks: AnswerBlock[]) {
  return blocks.flatMap((block) => block.kind === "paragraph" ? block.lines.flat()
    : block.kind === "heading" ? block.line : block.items.flat());
}

describe("inline citation layout", () => {
  it("keeps unmarked passages in the Sources panel without assigning them to sentences", () => {
    const paragraph = sentencesOf(layoutCitedAnswer(answer, [devices, access, lessons]));
    expect(paragraph).toHaveLength(2);
    expect(paragraph.map(segment => segment.sourceNumbers)).toEqual([[], []]);
  });

  it("honors explicit source order and removes only valid markers from answer text", () => {
    const paragraph = sentencesOf(layoutCitedAnswer("Access comes first [2]. Devices go back on the last day [1] [1]. Other [8].", [devices, access]));
    expect(paragraph.map(segment => segment.text)).toEqual(["Access comes first.", "Devices go back on the last day.", "Other [8]."]);
    expect(paragraph.map(segment => segment.sourceNumbers)).toEqual([[2], [1], []]);
  });

  it("copies plain answer text while keeping paragraphs and numbered lists", () => {
    expect(copyableAnswer("## Note\n\n2. Request **system access** [1].\n3. Keep the `ticket`.", [access]))
      .toBe("Note\n\n2. Request system access.\n3. Keep the ticket.");
  });
});

describe("answer formatting", () => {
  it("turns Markdown lists, headings and emphasis into structure without showing the characters", () => {
    const layout = layoutCitedAnswer("## Overview\nThe catalogue has **three groups**:\n\n- **Creational (5):** object creation.\n"
      + "- **Structural (7):** composition.\n1. First *step*\n2. Run `npm test`", []);
    expect(layout.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "list"]);
    const text = sentencesOf(layout).map((segment) => segment.text).join(" ");
    expect(text).not.toMatch(/[*#`]/);
    const [, intro, creational] = sentencesOf(layout);
    expect(intro!.parts).toEqual([{ text: "The catalogue has " }, { text: "three groups", strong: true }, { text: ":" }]);
    expect(creational!.parts[0]).toEqual({ text: "Creational (5):", strong: true });
    expect(layout[3]).toMatchObject({ kind: "list", ordered: true, start: 1 });
    expect(sentencesOf([layout[3]!]).flatMap((segment) => segment.parts)).toContainEqual({ text: "npm test", code: true });
  });

  it("keeps a bold phrase bold across a sentence boundary and leaves unpaired or literal characters visible", () => {
    const [first, second] = sentencesOf(layoutCitedAnswer("**Note. Read this.** Then continue.", []));
    expect(first!.parts).toEqual([{ text: "Note.", strong: true }]);
    expect(second!.parts[0]).toEqual({ text: "Read this.", strong: true });
    const [literal] = sentencesOf(layoutCitedAnswer("Use 2 * 3 * 4 and snake_case_name, or **unclosed.", []));
    expect(literal!.text).toBe("Use 2 * 3 * 4 and snake_case_name, or **unclosed.");
  });

  it("renders strong text, list items and citation chips together", () => {
    render(createElement(CitedAnswer, { body: "- **Access:** request system access five working days before the start date [1].",
      citations: [access], onOpen: vi.fn() }));
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Access:").tagName).toBe("STRONG");
    expect(item.textContent).not.toContain("**");
    expect(within(item).getByRole("button", { name: "Source 1: Synthetic Lifecycle Policy" }).textContent).toBe("1");
  });
});

describe("numbered source buttons", () => {
  it("opens the exact cited passage directly from a number", () => {
    const onOpen = vi.fn();
    render(createElement(CitedAnswer, { body: "Request access first [2].", citations: [devices, access], onOpen }));
    const button = screen.getByRole("button", { name: "Source 2: Synthetic Lifecycle Policy" });
    expect(button.textContent).toBe("2");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(access, button);
    expect(screen.queryByRole("group", { name: "Cited passages" })).toBeNull();
  });
});

describe("reader citation highlight", () => {
  const metadata = { title: "Synthetic Lifecycle Policy", ownerDepartment: "HR", summary: "", activeVersionId: "ver-1",
    versions: [{ id: "ver-1", label: "1.0", status: "EFFECTIVE" as const }] };
  const content = createElement("section", { "data-source-block-id": "b2" }, "All company devices must be returned to IT on the last working day.");
  const target = (navigationId: string): KnowledgeNavigationTarget => ({ ...devices, navigationId });

  it("highlights the cited block again when the same citation is opened a second time", () => {
    const props = { metadata, content, onBack: vi.fn() };
    const view = render(createElement(KnowledgeDocumentDetail, { ...props, focusTarget: target("first") }));
    const block = view.container.querySelector<HTMLElement>("[data-source-block-id='b2']")!;
    expect(block.classList.contains("is-citation-source")).toBe(true);
    // The highlight may be removed by the viewer re-rendering; a new request for the same passage restores it.
    block.classList.remove("is-citation-source");
    view.rerender(createElement(KnowledgeDocumentDetail, { ...props, focusTarget: target("second") }));
    expect(block.classList.contains("is-citation-source")).toBe(true);
    view.rerender(createElement(KnowledgeDocumentDetail, { ...props, focusTarget: null }));
    expect(block.classList.contains("is-citation-source")).toBe(false);
  });
});
