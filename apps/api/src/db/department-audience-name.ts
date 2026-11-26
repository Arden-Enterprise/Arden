/** Managed audience names have an 80-character database limit. */
export function departmentAudienceName(departmentName: string): string {
  const suffix = " members";
  return departmentName.length + suffix.length <= 80
    ? `${departmentName}${suffix}`
    : departmentName;
}
