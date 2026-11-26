/** Accepts an already trimmed, lower-cased address with a plausible DNS domain. */
export function isNormalizedEmail(email: string): boolean {
  if (email.length > 320 || email !== email.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return domain.length <= 253 && domain.split(".").every((label) =>
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
