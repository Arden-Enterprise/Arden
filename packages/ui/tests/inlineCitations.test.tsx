// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { layoutCitedAnswer, type AnswerCitation } from "../src/ask-arden/askArdenModel";
import { CitedAnswer } from "../src/ask-arden/CitedAnswer";
import { KnowledgeDocumentDetail } from "../src/knowledge/KnowledgeDocumentDetail";
import type { KnowledgeNavigationTarget } from "../src/knowledge/knowledgeCitation";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const policy = { documentId: "doc-1", versionId: "ver-1", title: "Synthetic Lifecycle Policy", version: "1.0", scope: "Company-wide",
  classification: "INTERNAL" as const, documentCode: "SYN-POL-1" };
const access: AnswerCitation = { ...policy, blockId: "b1", page: 1, excerpt: "Managers must request system access five working days before the start date." };
const devices: AnswerCitation = { ...policy, blockId: "b2", page: 1, excerpt: "All company devices must be returned to IT on the last working day." };
const lessons: AnswerCitation = { ...policy, documentId: "doc-2", versionId: "ver-2", title: "Synthetic Handover Lessons", documentCode: null,
  blockId: "c1", excerpt: "Unrelated archive retention text." };
const answer = "Request system access five working days before the start date. Return company devices to IT on the last working day.";

describe("inline citation layout", () => {
  it("places each passage after the sentence it supports and unmatched passages at the end", () => {
    const [paragraph] = layoutCitedAnswer(answer, [devices, access, lessons]);
    expect(paragraph).toHaveLength(2);
    expect(paragraph![0]!.sources.map((source) => source.citations)).toEqual([[access]]);
    expect(paragraph![1]!.sources.map((source) => source.label)).toEqual(["SYN-POL-1", "Synthetic Handover Lessons"]);
    expect(paragraph![1]!.text.endsWith("working day.")).toBe(true);
  });

  it("uses numbered markers when the answer provides them and removes the marker text", () => {
    const [paragraph] = layoutCitedAnswer("Access comes first [2]. Devices go back on the last day [1].", [devices, access]);
    expect(paragraph!.map((segment) => segment.text)).toEqual(["Access comes first.", "Devices go back on the last day."]);
    expect(paragraph![0]!.sources[0]!.citations).toEqual([access]);
    expect(paragraph![1]!.sources[0]!.citations).toEqual([devices]);
  });

  it("collapses repeated passages and groups one document per point", () => {
    const [paragraph] = layoutCitedAnswer("Return company devices to IT on the last working day.", [devices, { ...devices }, devices]);
    expect(paragraph![0]!.sources).toHaveLength(1);
    expect(paragraph![0]!.sources[0]!.citations).toHaveLength(1);
  });

  it("keeps paragraphs and leaves uncited sentences plain", () => {
    const layout = layoutCitedAnswer("Intro without support.\n\nReturn company devices to IT on the last working day.", [devices]);
    expect(layout).toHaveLength(2);
    expect(layout[0]![0]!.sources).toEqual([]);
    expect(layout[1]![0]!.sources).toHaveLength(1);
  });
});

describe("inline citation chips", () => {
  it("shows a compact chip, reveals the passages on hover and opens the chosen passage", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(createElement(CitedAnswer, { body: answer, citations: [access, devices, lessons], onOpen }));
    const chips = screen.getAllByRole("button", { name: /^Source:/ });
    expect(chips.map((chip) => chip.textContent)).toEqual(["SYN-POL-1", "SYN-POL-1+1"]);
    expect(screen.queryByRole("group", { name: "Cited passages" })).toBeNull();

    fireEvent.mouseEnter(chips[1]!);
    act(() => { vi.advanceTimersByTime(200); });
    const card = screen.getByRole("group", { name: "Cited passages" });
    expect(within(card).getByText(lessons.excerpt)).toBeTruthy();
    fireEvent.click(within(card).getAllByRole("button")[1]!);
    expect(onOpen).toHaveBeenCalledWith(lessons);
    expect(screen.queryByRole("group", { name: "Cited passages" })).toBeNull();

    fireEvent.click(chips[0]!);
    expect(onOpen).toHaveBeenLastCalledWith(access);
  });

  it("opens the passages from the keyboard and closes them with Escape", () => {
    render(createElement(CitedAnswer, { body: answer, citations: [access], onOpen: vi.fn() }));
    const chip = screen.getByRole("button", { name: /^Source:/ });
    fireEvent.focus(chip);
    expect(screen.getByRole("group", { name: "Cited passages" })).toBeTruthy();
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Cited passages" })).toBeNull();
  });
});

describe("reader citation highlight", () => {
  const metadata = { title: "Synthetic Lifecycle Policy", ownerDepartment: "HR", summary: "", activeVersionId: "ver-1",
    versions: [{ id: "ver-1", label: "1.0", status: "EFFECTIVE" as const, effectiveDate: "2026-11-01" }] };
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
