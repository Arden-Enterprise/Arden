/**
 * Flow 2 Target Readers (BM04 RF-03/RF-04): the per-document reader model that replaces audience groups.
 *
 * The policy is pure. Callers load facts (departments, memberships, the actor's departments) inside their
 * own transaction and pass them in, so the same decision runs in the API and in tests without a database.
 * Row-level security stays as defence in depth; this policy is the API-level check that closes BM02 R-01.
 */

export const readerModes = ["ORGANIZATION", "DEPARTMENT", "SELECTED_MEMBERS"] as const;
export type ReaderMode = typeof readerModes[number];
export const minSelectedReaders = 2;
export const maxSelectedReaders = 100;

/** What a client sends on draft save. Absent fields are treated as empty. */
export type TargetReadersInput = {
  mode: ReaderMode;
  departmentId?: string | null;
  memberIds?: readonly string[];
};

/** A validated, normalized selection. memberIds keeps the author's order. */
export type ReaderSelection = {
  mode: ReaderMode;
  departmentId: string | null;
  memberIds: readonly string[];
};

export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "LEFT";

export type SelectionFacts = {
  organizationId: string;
  /** Departments of the actor's organization that the caller could resolve. */
  departments: readonly { departmentId: string; organizationId: string; status: "ACTIVE" | "INACTIVE" | "ARCHIVED" }[];
  /** Memberships the caller could resolve; IDs from another organization are simply absent. */
  members: readonly { membershipId: string; organizationId: string; status: MembershipStatus; accountActive: boolean }[];
};

export type TargetReadersField = "targetReaders.mode" | "targetReaders.departmentId" | "targetReaders.memberIds";
export type SelectionValidation =
  | { ok: true; selection: ReaderSelection }
  | { ok: false; field: TargetReadersField; reason: string };

function invalid(field: TargetReadersField, reason: string): SelectionValidation {
  return { ok: false, field, reason };
}

export function validateSelection(input: TargetReadersInput, facts: SelectionFacts): SelectionValidation {
  if (!readerModes.includes(input.mode)) return invalid("targetReaders.mode", "Choose Organization, Department or Selected Members.");
  const departmentId = input.departmentId ?? null;
  const memberIds = input.memberIds ?? [];

  if (input.mode === "ORGANIZATION") {
    if (departmentId !== null) return invalid("targetReaders.departmentId", "Organization readers do not take a department.");
    if (memberIds.length) return invalid("targetReaders.memberIds", "Organization readers do not take members.");
    return { ok: true, selection: { mode: "ORGANIZATION", departmentId: null, memberIds: [] } };
  }

  if (input.mode === "DEPARTMENT") {
    if (memberIds.length) return invalid("targetReaders.memberIds", "Department readers do not take members.");
    if (departmentId === null) return invalid("targetReaders.departmentId", "Choose a department.");
    const department = facts.departments.find(candidate => candidate.departmentId === departmentId);
    if (!department || department.organizationId !== facts.organizationId || department.status !== "ACTIVE") {
      return invalid("targetReaders.departmentId", "Choose an active department of this organization.");
    }
    return { ok: true, selection: { mode: "DEPARTMENT", departmentId, memberIds: [] } };
  }

  if (departmentId !== null) return invalid("targetReaders.departmentId", "Selected Members do not take a department.");
  if (new Set(memberIds).size !== memberIds.length) return invalid("targetReaders.memberIds", "Each member can be chosen once.");
  if (memberIds.length < minSelectedReaders || memberIds.length > maxSelectedReaders) {
    return invalid("targetReaders.memberIds", `Choose ${minSelectedReaders} to ${maxSelectedReaders} members.`);
  }
  const resolved = new Map(facts.members.map(member => [member.membershipId, member]));
  const allActive = memberIds.every(id => {
    const member = resolved.get(id);
    return Boolean(member && member.organizationId === facts.organizationId
      && member.status === "ACTIVE" && member.accountActive);
  });
  if (!allActive) return invalid("targetReaders.memberIds", "Every member must be an active member of this organization.");
  return { ok: true, selection: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [...memberIds] } };
}

export type ReaderActor = {
  membershipId: string;
  organizationId: string;
  status: MembershipStatus;
  /** Active department memberships in active departments: the actor's current department(s). */
  departmentIds: readonly string[];
};

export type ReadablePublication = {
  organizationId: string;
  /**
   * The approved Target Readers of the publication. null means the publication predates Target Readers:
   * it keeps today's audience behaviour, which the audience-aware publication query already applied.
   */
  readers: ReaderSelection | null;
};

export function canRead(actor: ReaderActor | null, publication: ReadablePublication): boolean {
  if (!actor || actor.status !== "ACTIVE" || actor.organizationId !== publication.organizationId) return false;
  const readers = publication.readers;
  if (readers === null) return true;
  switch (readers.mode) {
    case "ORGANIZATION": return true;
    case "DEPARTMENT": return readers.departmentId !== null && actor.departmentIds.includes(readers.departmentId);
    case "SELECTED_MEMBERS": return readers.memberIds.includes(actor.membershipId);
    default: return false;
  }
}
