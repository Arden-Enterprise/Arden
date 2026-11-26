import { ApiError, type OrganizationAdministration } from "../shared/api-client";

export const MAX_INVITATIONS_PER_BATCH = 20;

export type InvitationCandidate = {
  email: string;
  status: "ready" | "invalid" | "member" | "pending";
};

export type InvitationBatchPlan = {
  candidates: InvitationCandidate[];
  duplicateCount: number;
  overLimit: boolean;
};

export type InvitationSendResult = {
  email: string;
  status: "sent" | "saved-locally" | "delivery-failed" | "conflict" | "rejected" | "blocked" | "unconfirmed" | "not-sent";
  message?: string;
};

export function planInvitationBatch(
  input: string,
  administration: Pick<OrganizationAdministration, "members" | "invitations">,
  now: number,
): InvitationBatchPlan {
  const uniqueEmails = new Set<string>();
  const memberEmails = new Set(administration.members.map((member) => member.email.toLowerCase()));
  const pendingEmails = new Set(administration.invitations
    .filter((invitation) => invitation.status === "PENDING" && new Date(invitation.expiresAt).getTime() > now)
    .map((invitation) => invitation.email.toLowerCase()));
  const candidates: InvitationCandidate[] = [];
  let duplicateCount = 0;

  for (const rawEmail of input.split(/[\s,;]+/)) {
    if (!rawEmail) continue;
    const email = rawEmail.toLowerCase();
    if (uniqueEmails.has(email)) {
      duplicateCount++;
      continue;
    }
    uniqueEmails.add(email);
    const status = email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "invalid"
      : memberEmails.has(email) ? "member"
        : pendingEmails.has(email) ? "pending" : "ready";
    candidates.push({ email, status });
  }

  return { candidates, duplicateCount, overLimit: candidates.length > MAX_INVITATIONS_PER_BATCH };
}

export async function sendInvitationBatch(
  emails: readonly string[],
  send: (email: string) => Promise<{ deliveryMode: "email" | "local-test-no-email" }>,
  onStart?: (current: number, total: number) => void,
): Promise<InvitationSendResult[]> {
  const results: InvitationSendResult[] = [];

  for (const [index, email] of emails.entries()) {
    onStart?.(index + 1, emails.length);
    try {
      const response = await send(email);
      if (response.deliveryMode !== "email" && response.deliveryMode !== "local-test-no-email") {
        results.push({ email, status: "unconfirmed" });
        for (const remainingEmail of emails.slice(index + 1)) {
          results.push({ email: remainingEmail, status: "not-sent" });
        }
        break;
      }
      results.push({ email, status: response.deliveryMode === "email" ? "sent" : "saved-locally" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 502 && error.code === "INVITATION_DELIVERY_FAILED") {
        results.push({ email, status: "delivery-failed" });
      } else if (error instanceof ApiError && error.status === 409 && error.code === "INVITATION_CONFLICT") {
        results.push({ email, status: "conflict" });
      } else if (error instanceof ApiError && error.status === 400 && error.code === "INVALID_EMAIL") {
        results.push({ email, status: "rejected" });
      } else {
        const blocked = error instanceof ApiError && [403, 404, 503].includes(error.status);
        results.push({ email, status: blocked ? "blocked" : "unconfirmed", message: blocked ? error.message : undefined });
        for (const remainingEmail of emails.slice(index + 1)) {
          results.push({ email: remainingEmail, status: "not-sent" });
        }
        break;
      }
    }
  }

  return results;
}
