/**
 * The department that owns and reviews a draft, as shown to the author. A server that reports the member's
 * primary department (decision 0014) derives it, so that value wins; an older server still uses the stored choice.
 */
export function ownerDepartment(primaryDepartmentId: string | null | undefined, storedResponsibleDepartmentId: string | null):
  { derived: boolean; departmentId: string | null } {
  return primaryDepartmentId === undefined
    ? { derived: false, departmentId: storedResponsibleDepartmentId }
    : { derived: true, departmentId: primaryDepartmentId };
}
