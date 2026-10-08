import type { InvitationEmail, InvitationMailer } from "./smtp-mailer.js";

export class LocalFlow1TestInvitationMailer implements InvitationMailer {
  async sendInvitation(_message: InvitationEmail): Promise<void> {
    // Local flow testing verifies the persisted pending invitation, not email delivery.
  }

  close(): void {}
}
