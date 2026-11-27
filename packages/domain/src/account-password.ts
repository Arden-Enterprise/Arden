/** Typed password length before the provider hashes it. Counts the same units as the field and API schema. */
export const accountPasswordMaximumLength = 100;

export const accountPasswordMaximumLengthMessage = "Password must be 100 characters or fewer.";

/** Server-side message for a password that fails the account requirements. */
export const accountPasswordRequirementsMessage =
  "Password must have at least 8 characters, one uppercase letter, one lowercase letter, and one special character.";

export type AccountPasswordChecks = {
  minimumLength: boolean;
  uppercaseLetter: boolean;
  lowercaseLetter: boolean;
  specialCharacter: boolean;
};

export function checkAccountPassword(password: string): AccountPasswordChecks {
  return {
    minimumLength: [...password].length >= 8,
    uppercaseLetter: /\p{Lu}/u.test(password),
    lowercaseLetter: /\p{Ll}/u.test(password),
    specialCharacter: /[\p{P}\p{S}]/u.test(password),
  };
}

export function meetsAccountPasswordRequirements(password: string): boolean {
  const checks = checkAccountPassword(password);
  return password.length <= accountPasswordMaximumLength
    && checks.minimumLength && checks.uppercaseLetter && checks.lowercaseLetter && checks.specialCharacter;
}
