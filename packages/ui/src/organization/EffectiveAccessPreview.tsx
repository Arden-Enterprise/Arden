import { membershipReadiness } from "./organizationWorkflow";
import type { OrganizationMember, OrganizationPreview } from "./previewModel";

/** Session-preview summary of what one synthetic member can reach (sample data, not server authorization). */
export function EffectiveAccessPreview({ organization, member }: { organization: OrganizationPreview; member?: OrganizationMember }) {
  const department = organization.departments.find((item) => item.id === member?.departmentId);
  const readiness = member ? membershipReadiness(organization, member.id) : undefined;
  return <section className="organization-surface organization-effective-access">
    <div className="organization-effective-heading"><h2>Effective access</h2>{member && <><span className="organization-status status-info">{member.name}</span><span className="organization-status">{member.role || "Role not assigned"} · {department?.name || "Department not assigned"}</span></>}</div>
    <div className="organization-access-boundaries">
      <div><span className="meta-label organization-jade">CAPABILITY</span><strong>{readiness?.state === "ready" ? member?.role === "Organization Admin" ? "Can configure the organization" : "Can read authorized knowledge and contribute" : "Workspace access is not ready"}</strong><small>{member?.roleScope === "organization" ? "Organization responsibility" : "Primary department responsibility"}</small></div>
      <div><span className="meta-label organization-blue">DEPARTMENT</span><strong>{department ? `${department.name} publications` : "Waiting for a primary department"}</strong></div>
      <div><span className="meta-label organization-amber">PRIVATE</span><strong>Owner only — including for admins</strong></div>
    </div>
  </section>;
}
