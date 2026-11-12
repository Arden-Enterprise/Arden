import { describe, expect, it } from "vitest";
import { checkAccountPassword, meetsAccountPasswordRequirements } from "./account-password.js";

describe("account password checks", () => {
  it("distinguishes each missing requirement at the eight-character boundary", () => {
    expect(checkAccountPassword("Abcdef!")).toEqual({ minimumLength: false, uppercaseLetter: true, specialCharacter: true });
    expect(checkAccountPassword("abcdefgh!")).toEqual({ minimumLength: true, uppercaseLetter: false, specialCharacter: true });
    expect(checkAccountPassword("Abcdefgh")).toEqual({ minimumLength: true, uppercaseLetter: true, specialCharacter: false });
    expect(checkAccountPassword("Abcdefg!")).toEqual({ minimumLength: true, uppercaseLetter: true, specialCharacter: true });
    expect(meetsAccountPasswordRequirements("Abcdefg!")).toBe(true);
    expect(meetsAccountPasswordRequirements("Abcdefgh")).toBe(false);
  });

  it("recognizes uppercase letters and punctuation without treating accented lowercase as special", () => {
    expect(checkAccountPassword("Ébcdefg!")).toEqual({ minimumLength: true, uppercaseLetter: true, specialCharacter: true });
    expect(checkAccountPassword("Abcdefgé").specialCharacter).toBe(false);
  });
});
