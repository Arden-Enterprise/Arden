/**
 * Flow 2 T2.1 (BM04 RF-03): a reviewer approves the proposed Target Readers as they are or narrows them,
 * never widens them. Pure; the caller loads facts inside the decision transaction.
 *
 * | Proposed (P)         | Approved (A) allowed                                                        |
 * | ORGANIZATION         | ORGANIZATION; DEPARTMENT (any active department); SELECTED_MEMBERS (2-100)   |
 * | DEPARTMENT d         | DEPARTMENT d; SELECTED_MEMBERS whose every member is currently in d          |
 * | SELECTED_MEMBERS S   | SELECTED_MEMBERS S' with S' a subset of S and |S'| >= 2                      |
 */
import { validateSelection, type ReaderSelection, type SelectionFacts, type TargetReadersInput } from "./policy.js";

export type ApprovedReadersField = "approvedReaders.mode" | "approvedReaders.departmentId" | "approvedReaders.memberIds";

export type ApprovedReadersResult =
  | { ok: true; selection: ReaderSelection; narrowed: boolean }
  | { ok: false; reason: "INVALID_READERS"; field: ApprovedReadersField; message: string }
  | { ok: false; reason: "READERS_WIDENED" };

function memberSet(selection: ReaderSelection): Set<string> {
  return new Set(selection.memberIds);
}

/** Same readers regardless of member order. */
export function sameReaders(left: ReaderSelection, right: ReaderSelection): boolean {
  if (left.mode !== right.mode || left.departmentId !== right.departmentId
    || left.memberIds.length !== right.memberIds.length) return false;
  const members = memberSet(left);
  return right.memberIds.every(id => members.has(id));
}

/** Whether A admits nobody that P does not admit, judged with current department facts. */
export function isWithinProposed(proposed: ReaderSelection, approved: ReaderSelection, facts: SelectionFacts): boolean {
  switch (proposed.mode) {
    case "ORGANIZATION":
      return true;
    case "DEPARTMENT": {
      if (approved.mode === "DEPARTMENT") return approved.departmentId === proposed.departmentId;
      if (approved.mode !== "SELECTED_MEMBERS" || proposed.departmentId === null) return false;
      const departments = new Map(facts.members.map(member => [member.membershipId, member.departmentIds ?? []]));
      return approved.memberIds.every(id => departments.get(id)?.includes(proposed.departmentId!) === true);
    }
    case "SELECTED_MEMBERS": {
      if (approved.mode !== "SELECTED_MEMBERS") return false;
      const allowed = memberSet(proposed);
      return approved.memberIds.every(id => allowed.has(id));
    }
    default:
      return false;
  }
}

/**
 * Resolves the approved readers. Absent → a copy of P. Present → it must first be a valid selection
 * (400 INVALID_READERS) and then no wider than P (409 READERS_WIDENED).
 */
export function resolveApprovedReaders(proposed: ReaderSelection, requested: TargetReadersInput | undefined,
  facts: SelectionFacts): ApprovedReadersResult {
  if (requested === undefined) {
    return { ok: true, selection: { ...proposed, memberIds: [...proposed.memberIds] }, narrowed: false };
  }
  const validation = validateSelection(requested, facts);
  if (!validation.ok) {
    return { ok: false, reason: "INVALID_READERS", message: validation.reason,
      field: validation.field.replace("targetReaders.", "approvedReaders.") as ApprovedReadersField };
  }
  if (!isWithinProposed(proposed, validation.selection, facts)) return { ok: false, reason: "READERS_WIDENED" };
  return { ok: true, selection: validation.selection, narrowed: !sameReaders(proposed, validation.selection) };
}
