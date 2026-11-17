import type { KnowledgeReviewDetail, TargetReaders } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { targetReadersLabel } from "./KnowledgeMetadataFields";
import { TargetReadersField, targetReadersComplete } from "./TargetReadersField";

/**
 * T2.1/T2.2: a reviewer approves the proposed readers as they are, or keeps fewer of them. Narrowing only:
 * Everyone → one department or selected members; a department → selected members of that department;
 * selected members → a subset of at least two. `null` means "as proposed". The server re-checks every rule.
 */
export function ApprovedReadersField({ review, value, departments, departmentName, busy, platform, organizationId, onChange }: {
  review: KnowledgeReviewDetail; value: TargetReaders | null;
  departments: Array<{ id: string; name: string }>; departmentName: (id: string | null) => string;
  busy: boolean; platform: Platform; organizationId: string; onChange: (value: TargetReaders | null) => void;
}) {
  const proposed = review.proposedTargetReaders;
  if (!proposed || review.requestType === "WITHDRAWAL") return null;
  const names = new Map((review.proposedReaders?.members ?? []).map(member => [member.membershipId, member.displayName]));
  const proposedDepartmentName = review.proposedReaders?.department?.name ?? departmentName(proposed.departmentId);
  const narrowStart = (): TargetReaders => proposed.mode === "SELECTED_MEMBERS"
    ? { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [...proposed.memberIds] }
    : proposed.mode === "DEPARTMENT" ? { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] }
      : { mode: "DEPARTMENT", departmentId: null, memberIds: [] };
  const incomplete = value !== null && !targetReadersComplete(value);

  return <fieldset className="review-approved-readers" disabled={busy}>
    <legend className="review-section-label">APPROVE FOR</legend>
    <label className="review-approved-choice"><input type="radio" name="approved-readers" checked={value === null}
      onChange={() => onChange(null)} /><span><strong>Proposed readers</strong>
      <small>{targetReadersLabel(proposed, departmentName)}</small></span></label>
    {!(proposed.mode === "SELECTED_MEMBERS" && proposed.memberIds.length <= 2) && <label className="review-approved-choice">
      <input type="radio" name="approved-readers" checked={value !== null} onChange={() => onChange(narrowStart())} />
      <span><strong>Fewer readers</strong><small>Approve for part of the proposed readers.</small></span></label>}
    {value && proposed.mode === "SELECTED_MEMBERS" && <ul className="review-approved-members" aria-label="Approved readers">
      {proposed.memberIds.map(id => <li key={id}><label><input type="checkbox" checked={value.memberIds.includes(id)}
        onChange={event => onChange({ ...value, memberIds: event.target.checked
          ? proposed.memberIds.filter(member => member === id || value.memberIds.includes(member))
          : value.memberIds.filter(member => member !== id) })} />
        <span>{names.get(id) ?? "Member unavailable"}</span></label></li>)}
    </ul>}
    {value && proposed.mode === "DEPARTMENT" && <TargetReadersField readers={value} departments={departments} busy={busy}
      platform={platform} organizationId={organizationId} onReaders={onChange} modes={["SELECTED_MEMBERS"]}
      legend={`Members of ${proposedDepartmentName}`} memberFilter={member => member.department === proposedDepartmentName} />}
    {value && proposed.mode === "ORGANIZATION" && <TargetReadersField readers={value} departments={departments} busy={busy}
      platform={platform} organizationId={organizationId} onReaders={onChange} modes={["DEPARTMENT", "SELECTED_MEMBERS"]}
      legend="Narrow to" />}
    {value && proposed.mode === "SELECTED_MEMBERS" && <small role="status">
      {value.memberIds.length} of {proposed.memberIds.length} kept · keep at least 2</small>}
    {incomplete && <small role="status">
      {value.mode === "DEPARTMENT" ? "Choose a department to approve." : "Keep at least 2 readers to approve."}</small>}
  </fieldset>;
}

/** Approve stays disabled while a narrowed selection is incomplete. */
export function approvedReadersReady(value: TargetReaders | null): boolean {
  return value === null || targetReadersComplete(value);
}
