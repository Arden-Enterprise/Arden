import nodemailer, { type Transporter } from "nodemailer";

export type InvitationEmail = {
  to: string;
  organizationName: string;
  invitationUrl: string;
  expiresAt: Date;
};

export interface InvitationMailer {
  sendInvitation(message: InvitationEmail): Promise<void>;
  close(): void;
}

export type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderInvitationEmailHtml(message: InvitationEmail): string {
  const escapedOrg = escapeHtml(message.organizationName);
  const safeUrl = /^https?:\/\//i.test(message.invitationUrl) ? escapeHtml(message.invitationUrl) : "#";
  const formattedExpiry = message.expiresAt.toUTCString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to join ${escapedOrg} on Arden</title>
</head>
<body style="margin: 0; padding: 0; background-color: #1c1e20; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f3ef;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #1c1e20; width: 100%; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #242628; border: 1px solid #33373a; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="height: 3px; background-color: #e7b970; line-height: 3px; font-size: 3px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding: 32px 36px 20px 36px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <span style="display: inline-block; font-size: 18px; font-weight: 700; letter-spacing: 2px; color: #f4f3ef; text-transform: uppercase;">ARDEN</span>
                    <span style="display: block; font-size: 11px; font-weight: 500; letter-spacing: 1.5px; color: #929698; text-transform: uppercase; margin-top: 4px;">ORGANIZATIONAL MEMORY &amp; CONTEXT</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 36px;">
              <div style="height: 1px; background-color: #33373a; width: 100%;"></div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 36px 32px 36px;">
              <div style="display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: #80c5b8; margin-bottom: 12px;">MEMBERSHIP INVITATION</div>
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; line-height: 1.35; color: #f4f3ef;">
                You&#39;ve been invited to join <span style="color: #e7b970;">${escapedOrg}</span>
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #d4d5d5;">
                You have been invited to collaborate with your team on Arden. Click the button below to accept the invitation, set up your account, and access your workspace.
              </p>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0 24px 0;">
                <tr>
                  <td align="center" style="border-radius: 6px; background-color: #e7b970;">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 28px; font-size: 14px; font-weight: 600; color: #1c1e20; text-decoration: none; border-radius: 6px; letter-spacing: 0.2px;">
                      Accept Invitation &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <div style="background-color: #1c1e20; border: 1px solid #33373a; border-radius: 6px; padding: 14px 16px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px 0; font-size: 12px; line-height: 1.5; color: #a5aaac;">
                  <strong style="color: #d4d5d5;">Expires:</strong> ${escapeHtml(formattedExpiry)}
                </p>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a5aaac; word-break: break-all;">
                  Button not working? Paste this link into your browser:<br>
                  <a href="${safeUrl}" style="color: #e7b970; text-decoration: underline;">${safeUrl}</a>
                </p>
              </div>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-left: 3px solid #80c5b8; background-color: #2d3032; border-radius: 0 6px 6px 0; padding: 12px 14px; margin-top: 20px;">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #d4d5d5;">
                      <strong style="color: #80c5b8;">Your personal notes stay private:</strong> Joining an organization never shares your personal drafts or private documents with colleagues or administrators.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 36px 28px 36px; background-color: #1c1e20; border-top: 1px solid #33373a; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #929698; line-height: 1.5;">
                If you were not expecting this invitation, you can safely ignore this email.
              </p>
              <p style="margin: 0; font-size: 11px; color: #656b6e; line-height: 1.4;">
                &copy; Arden &middot; Private organizational memory and work context
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function createSmtpMailer(configuration: SmtpConfiguration): InvitationMailer {
  const transporter: Transporter = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: !configuration.secure,
    auth: { user: configuration.user, pass: configuration.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async sendInvitation(message) {
      await transporter.sendMail({
        from: configuration.from,
        to: message.to,
        subject: `Invitation to join ${message.organizationName} on Arden`,
        text: `You have been invited to join ${message.organizationName} on Arden.\n\nOpen this link to sign in or create an account and accept the invitation:\n${message.invitationUrl}\n\nThis link expires on ${message.expiresAt.toISOString()}. If you were not expecting this invitation, you can ignore this email.`,
        html: renderInvitationEmailHtml(message),
      });
    },
    close() { transporter.close(); },
  };
}

export function smtpConfigurationFromEnvironment(environment: NodeJS.ProcessEnv): SmtpConfiguration | null {
  const values = [environment.SMTP_HOST, environment.SMTP_PORT, environment.SMTP_SECURE,
    environment.SMTP_USER, environment.SMTP_PASS, environment.SMTP_FROM];
  if (values.every((value) => value === undefined || value === "")) return null;
  if (values.some((value) => value === undefined || value === "")) throw new Error("SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and SMTP_FROM must be configured together");
  const port = Number(environment.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid TCP port");
  if (environment.SMTP_SECURE !== "true" && environment.SMTP_SECURE !== "false") throw new Error("SMTP_SECURE must be true or false");
  return {
    host: environment.SMTP_HOST!, port, secure: environment.SMTP_SECURE === "true",
    user: environment.SMTP_USER!, password: environment.SMTP_PASS!, from: environment.SMTP_FROM!,
  };
}
