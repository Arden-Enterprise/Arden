import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { Icon, iconGlyphs } from "../src/shared/Icon";

const require = createRequire(import.meta.url);
const upstreamCss = readFileSync(require.resolve("@flaticon/flaticon-uicons/css/regular/rounded.css"), "utf8");

describe("local Flaticon icon adapter", () => {
  it("maps every icon to a glyph available in the pinned Regular Rounded family", () => {
    for (const glyph of Object.values(iconGlyphs)) {
      expect(upstreamCss).toContain('content:"\\' + glyph.codePointAt(0)?.toString(16) + '"');
    }
    expect(new Set(Object.values(iconGlyphs)).size).toBe(Object.keys(iconGlyphs).length);
  });

  it("keeps decorative icons out of the accessible name and preserves requested size", () => {
    const icon = Icon({ name: "review", size: 25 });
    expect(icon.props["aria-hidden"]).toBe("true");
    expect(icon.props.focusable).toBe("false");
    expect(icon.props.width).toBe(25);
    expect(icon.props.height).toBe(25);
  });
});
