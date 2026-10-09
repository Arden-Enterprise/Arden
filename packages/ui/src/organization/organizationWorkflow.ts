import {
  primaryRoles,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizationPreview,
  type PrimaryRole,
} from "./previewModel";

export type OrganizationAction =
  | { type: "invite"; id: string; name: string; email: string }
  | { type: "accept"; invitationId: string; email: string; memberId: string }
  | { type: "resend"; invitationId: string }
  | { type: "revoke"; invitationId: string }
  | { type: "assign"; memberId: string; departmentId: string; role: PrimaryRole; roleScope: "organization" | "department" }
  | { type: "status"; memberId: string; status: "active" | "suspended" };

export type OrganizationTransitionResult = {
  organization: OrganizationPreview;
  error?: string;
  memberId?: string;
};

export type MembershipReadiness = {
  state: "ready" | "pending" | "denied";
  message: string;
};

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function invitationStatus(
  invitation: OrganizationInvitation,
  now: number,
): "pending" | "accepted" | "revoked" | "expired" {
  if (invitation.status !== "pending") return invitation.status;
  if (!Number.isFinite(now) || !Number.isFinite(invitation.expiresAt) || now >= invitation.expiresAt) {
    return "expired";
  }
  return "pending";
}

function memberEmailConflict(organization: OrganizationPreview, email: string): string | undefined {
  const member = organization.members.find((item) => normalizeEmail(item.email) === email);
  if (!member) return undefined;
  if (member.status === "suspended") {
    return "This member is suspended. Restore their access instead of sending a new invitation.";
  }
  return "This email address already belongs to an organization member.";
}

function hasPendingInvitation(
  organization: OrganizationPreview,
  email: string,
  now: number,
  exceptId?: string,
): boolean {
  return (organization.invitations ?? []).some((invitation) =>
    invitation.id !== exceptId
    && normalizeEmail(invitation.email) === email
    && invitationStatus(invitation, now) === "pending",
  );
}

function replaceInvitation(
  organization: OrganizationPreview,
  replacement: OrganizationInvitation,
): OrganizationPreview {
  return {
    ...organization,
    invitations: (organization.invitations ?? []).map((invitation) =>
      invitation.id === replacement.id ? replacement : invitation,
    ),
  };
}

function isActiveAdmin(organization: OrganizationPreview, member: OrganizationMember): boolean {
  return member.role === "System Admin" && membershipReadiness(organization, member.id).state === "ready";
}

function isLastActiveAdmin(organization: OrganizationPreview, member: OrganizationMember): boolean {
  return isActiveAdmin(organization, member)
    && organization.members.filter((item) => isActiveAdmin(organization, item)).length === 1;
}

export function membershipReadiness(organization: OrganizationPreview, memberId: string): MembershipReadiness {
  const member = organization.members.find((item) => item.id === memberId);
  if (!member) return { state: "denied", message: "You are not a member of this organization." };
  if (member.status === "suspended") {
    return { state: "denied", message: "Your membership is suspended. Contact an organization administrator." };
  }
  const departmentExists = organization.departments.some((department) => department.id === member.departmentId);
  const roleAssigned = primaryRoles.some((role) => role === member.role);
  if (member.status === "pending-assignment" || !departmentExists || !roleAssigned) {
    return {
      state: "pending",
      message: "An administrator must assign your primary department and role before you can enter.",
    };
  }
  const validRoleScope = member.roleScope === "organization" || member.roleScope === "department";
  if (!validRoleScope || (member.role === "System Admin" && member.roleScope !== "organization")) {
    return { state: "denied", message: "Your access configuration needs an administrator's review." };
  }
  return { state: "ready", message: "Your membership is active and its department and role are assigned." };
}

/** In-memory UI transitions only. Shared access must be authorized by Arden's server. */
export function transitionOrganization(
  organization: OrganizationPreview,
  action: OrganizationAction,
  now: number,
): OrganizationTransitionResult {
  if (!Number.isFinite(now)) return { organization, error: "The invitation clock is unavailable. Try again." };

  if (action.type === "invite") {
    const id = action.id.trim();
    const name = action.name.trim();
    const email = normalizeEmail(action.email);
    if (!name) return { organization, error: "Enter the member's name." };
    if (!emailPattern.test(email)) return { organization, error: "Enter a valid email address." };
    if (!id || (organization.invitations ?? []).some((invitation) => invitation.id === id)) {
      return { organization, error: "This invitation identifier is already in use or is missing." };
    }
    const memberConflict = memberEmailConflict(organization, email);
    if (memberConflict) return { organization, error: memberConflict };
    if (hasPendingInvitation(organization, email, now)) {
      return { organization, error: "A pending invitation already exists for this email address." };
    }
    const invitation: OrganizationInvitation = {
      id,
      name,
      email,
      status: "pending",
      createdAt: now,
      expiresAt: now + invitationLifetimeMs,
      resendCount: 0,
    };
    return {
      organization: { ...organization, invitations: [...(organization.invitations ?? []), invitation] },
    };
  }

  if (action.type === "accept" || action.type === "resend" || action.type === "revoke") {
    const invitation = (organization.invitations ?? []).find((item) => item.id === action.invitationId);
    if (!invitation) return { organization, error: "This invitation is unavailable." };
    if (invitation.status === "accepted") return { organization, error: "This invitation has already been accepted." };
    if (invitation.status === "revoked") return { organization, error: "This invitation has been revoked." };

    if (action.type === "revoke") {
      return { organization: replaceInvitation(organization, { ...invitation, status: "revoked" }) };
    }
    if (action.type === "resend") {
      const email = normalizeEmail(invitation.email);
      const memberConflict = memberEmailConflict(organization, email);
      if (memberConflict) return { organization, error: memberConflict };
      if (hasPendingInvitation(organization, email, now, invitation.id)) {
        return { organization, error: "A newer pending invitation already exists for this email address." };
      }
      return {
        organization: replaceInvitation(organization, {
          ...invitation,
          expiresAt: now + invitationLifetimeMs,
          resendCount: invitation.resendCount + 1,
        }),
      };
    }
    if (invitationStatus(invitation, now) === "expired") {
      return { organization, error: "This invitation has expired. Ask an administrator to send it again." };
    }
    if (normalizeEmail(action.email) !== normalizeEmail(invitation.email)) {
      return { organization, error: "Sign in with the email address this invitation was sent to." };
    }
    const memberId = action.memberId.trim();
    if (!memberId || organization.members.some((member) => member.id === memberId)) {
      return { organization, error: "This membership identifier is already in use or is missing." };
    }
    const memberConflict = memberEmailConflict(organization, normalizeEmail(invitation.email));
    if (memberConflict) return { organization, error: memberConflict };
    const member: OrganizationMember = {
      id: memberId,
      name: invitation.name,
      email: normalizeEmail(invitation.email),
      departmentId: "",
      role: "",
      status: "pending-assignment",
    };
    const nextOrganization = replaceInvitation(organization, { ...invitation, status: "accepted", memberId });
    return {
      organization: { ...nextOrganization, members: [...organization.members, member] },
      memberId,
    };
  }

  const member = organization.members.find((item) => item.id === action.memberId);
  if (!member) return { organization, error: "This organization member is unavailable." };

  if (action.type === "assign") {
    if (!organization.departments.some((department) => department.id === action.departmentId)) {
      return { organization, error: "Choose an existing primary department." };
    }
    if (!primaryRoles.includes(action.role)) return { organization, error: "Choose an existing role." };
    if (action.roleScope !== "organization" && action.roleScope !== "department") {
      return { organization, error: "Choose an organization or department role scope." };
    }
    if (action.role === "System Admin" && action.roleScope !== "organization") {
      return { organization, error: "System Admin manages the organization and requires organization scope." };
    }
    if (action.role !== "System Admin" && isLastActiveAdmin(organization, member)) {
      return { organization, error: "Keep at least one active System Admin before changing this role." };
    }
    return {
      organization: {
        ...organization,
        members: organization.members.map((item) => item.id === member.id ? {
          ...item,
          departmentId: action.departmentId,
          role: action.role,
          roleScope: action.roleScope,
          status: item.status === "suspended" ? "suspended" : "active",
        } : item),
      },
      memberId: member.id,
    };
  }

  if (action.status === "suspended" && isLastActiveAdmin(organization, member)) {
    return { organization, error: "Keep at least one active System Admin before suspending this member." };
  }
  if (action.status === "active") {
    const readiness = membershipReadiness({
      ...organization,
      members: organization.members.map((item) => item.id === member.id ? { ...item, status: "active" } : item),
    }, member.id);
    if (readiness.state !== "ready") {
      return { organization, error: "Assign a valid primary department, role and scope before restoring access." };
    }
  }
  if (member.status === action.status) return { organization, memberId: member.id };
  return {
    organization: {
      ...organization,
      members: organization.members.map((item) => item.id === member.id ? { ...item, status: action.status } : item),
    },
    memberId: member.id,
  };
}
