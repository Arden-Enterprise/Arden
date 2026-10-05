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

export function createSmtpMailer(configuration: SmtpConfiguration): InvitationMailer {
  const transporter: Transporter = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    auth: { user: configuration.user, pass: configuration.password },
  });
  return {
    async sendInvitation(message) {
      await transporter.sendMail({
        from: configuration.from,
        to: message.to,
        subject: `Invitation to join ${message.organizationName} on Arden`,
        text: `You have been invited to join ${message.organizationName} on Arden.\n\nOpen this link to sign in or create an account and accept the invitation:\n${message.invitationUrl}\n\nThis link expires on ${message.expiresAt.toISOString()}. If you were not expecting this invitation, you can ignore this email.`,
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
