import { expect, it } from "vitest";
import { activeInlineFormats, toggleInlineFormat } from "../src/shared/markdownInlineFormat";

it("wraps the selection and keeps the text selected inside the markers", () => {
  const edit = toggleInlineFormat("Alpha selected omega.", 6, 14, "bold")!;
  expect(edit.value).toBe("Alpha **selected** omega.");
  expect(edit.value.slice(edit.start, edit.end)).toBe("selected");
  expect(edit.value.slice(0, edit.from) + edit.insert + "Alpha selected omega.".slice(edit.to)).toBe(edit.value);
  expect(activeInlineFormats(edit.value, edit.start, edit.end)).toEqual({ bold: true, italic: false, strike: false, code: false });
});

it("removes markers around or inside the selection", () => {
  expect(toggleInlineFormat("Alpha **selected** omega.", 8, 16, "bold")!.value).toBe("Alpha selected omega.");
  expect(toggleInlineFormat("Alpha **selected** omega.", 6, 18, "bold")!.value).toBe("Alpha selected omega.");
  expect(toggleInlineFormat("a _b_ c", 2, 5, "italic")!.value).toBe("a b c");
});

it("keeps surrounding spaces and Markdown block syntax outside the markers", () => {
  expect(toggleInlineFormat("Say  hello  now", 3, 12, "strike")!.value).toBe("Say  ~~hello~~  now");
  expect(toggleInlineFormat("- first\n- second", 0, 16, "code")!.value).toBe("- `first`\n- `second`");
  expect(toggleInlineFormat("## Title", 0, 8, "italic")!.value).toBe("## _Title_");
});

it("formats every line and removes the format only when every line has it", () => {
  const mixed = "**one**\ntwo";
  const edit = toggleInlineFormat(mixed, 0, mixed.length, "bold")!;
  expect(edit.value).toBe("**one**\n**two**");
  expect(toggleInlineFormat(edit.value, 0, edit.value.length, "bold")!.value).toBe("one\ntwo");
});

it("ignores a whitespace-only selection", () => {
  expect(toggleInlineFormat("a   b", 1, 4, "bold")).toBeNull();
});
