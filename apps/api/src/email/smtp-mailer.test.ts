import { describe, expect, it } from "vitest";
import { smtpConfigurationFromEnvironment } from "./smtp-mailer.js";

describe("SMTP runtime configuration", () => {
  it("does not configure invitation delivery when all SMTP settings are empty", () => {
    expect(smtpConfigurationFromEnvironment({ SMTP_HOST: "", SMTP_PORT: "", SMTP_SECURE: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "" })).toBeNull();
  });

  it("rejects incomplete SMTP settings so a deployment cannot silently send without its configured credentials", () => {
    expect(() => smtpConfigurationFromEnvironment({ SMTP_HOST: "smtp.example.test" })).toThrow("must be configured together");
  });

  it("validates the port and transport security flag without exposing the password", () => {
    const configuration = smtpConfigurationFromEnvironment({
      SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false",
      SMTP_USER: "arden@example.test", SMTP_PASS: "private-secret", SMTP_FROM: "Arden <arden@example.test>",
    });
    expect(configuration).toEqual({
      host: "smtp.example.test", port: 587, secure: false,
      user: "arden@example.test", password: "private-secret", from: "Arden <arden@example.test>",
    });
    expect(() => smtpConfigurationFromEnvironment({
      SMTP_HOST: "smtp.example.test", SMTP_PORT: "0", SMTP_SECURE: "false",
      SMTP_USER: "arden@example.test", SMTP_PASS: "private-secret", SMTP_FROM: "arden@example.test",
    })).toThrow("SMTP_PORT must be a valid TCP port");
  });
});
