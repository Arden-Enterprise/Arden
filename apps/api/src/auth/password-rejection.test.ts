import { describe, expect, it } from "vitest";
import { passwordMessages } from "@arden/domain";
import { passwordProviderMessage } from "./password-rejection.js";

describe("passwordProviderMessage", () => {
  it("uses the old-password sentence when the new password matches the stored one", () => {
    expect(passwordProviderMessage({ code: "same_password", message: "New password should be different from the old password." }, "Aaaaaaa1!")).toBe(passwordMessages.reused);
  });

  it("uses the breach sentence when the provider reports a leaked password", () => {
    expect(passwordProviderMessage({
      code: "weak_password",
      reasons: ["pwned"],
      message: "Password is known to be weak and easy to guess, please choose a different one.",
    }, "Password1!")).toBe(passwordMessages.breach);
  });

  it("keeps a short fallback when the provider text is not one of the known cases", () => {
    expect(passwordProviderMessage({ code: "weak_password", message: "something unexpected and very long from the provider" }, "Aaaaaaa1!")).toBe(passwordMessages.unusable);
  });
});
