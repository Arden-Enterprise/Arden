import { describe, expect, it } from "vitest";
import { passwordIssue, passwordMessages } from "./password-policy.js";

describe("passwordIssue", () => {
  it("names the first missing requirement", () => {
    expect(passwordIssue("short")).toBe(passwordMessages.length);
    expect(passwordIssue("AAAAAAAA")).toBe(passwordMessages.lowercase);
    expect(passwordIssue("aaaaaaaa")).toBe(passwordMessages.capital);
    expect(passwordIssue("Aaaaaaaa")).toBe(passwordMessages.number);
    expect(passwordIssue("Aaaaaaa1")).toBe(passwordMessages.symbol);
  });

  it("accepts a password with every required class", () => {
    expect(passwordIssue("Aaaaaaa1!")).toBeNull();
    expect(passwordIssue("New-secure-password1")).toBeNull();
  });
});
