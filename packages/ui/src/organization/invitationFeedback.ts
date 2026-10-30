export type InvitationFeedback = { role: "alert" | "status"; className: string; text: string };

export function invitationFeedback(error: string, message: string): InvitationFeedback | null {
  if (error) return { role: "alert", className: "auth-message", text: error };
  if (message) return { role: "status", className: "auth-message is-success", text: message };
  return null;
}
