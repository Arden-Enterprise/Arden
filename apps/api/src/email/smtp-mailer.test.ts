import nodemailer, { type Transporter } from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSmtpMailer } from "./smtp-mailer.js";
import { smtpConfigurationFromEnvironment } from "./smtp-mailer.js";

afterEach(() => vi.restoreAllMocks());

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

  it("requires TLS for STARTTLS SMTP and bounds connection timeouts", () => {
    const fakeTransporter = { sendMail: vi.fn(), close: vi.fn() } as unknown as Transporter;
    const createTransport = vi.spyOn(nodemailer, "createTransport").mockReturnValue(fakeTransporter);

    createSmtpMailer({
      host: "smtp.example.test", port: 587, secure: false,
      user: "arden@example.test", password: "private-secret", from: "Arden <arden@example.test>",
    });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      secure: false,
      requireTLS: true,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    }));
  });

  it("uses implicit TLS without STARTTLS negotiation when configured for port 465", () => {
    const fakeTransporter = { sendMail: vi.fn(), close: vi.fn() } as unknown as Transporter;
    const createTransport = vi.spyOn(nodemailer, "createTransport").mockReturnValue(fakeTransporter);

    createSmtpMailer({
      host: "smtp.example.test", port: 465, secure: true,
      user: "arden@example.test", password: "private-secret", from: "Arden <arden@example.test>",
    });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port: 465,
      secure: true,
      requireTLS: false,
    }));
  });
});
