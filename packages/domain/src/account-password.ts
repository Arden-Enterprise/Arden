/** Typed password length before the provider hashes it. Counts the same units as the field and API schema. */
export const accountPasswordMaximumLength = 100;

export const accountPasswordMaximumLengthMessage = "Password must be 100 characters or fewer.";

export type AccountPasswordChecks = {
  minimumLength: boolean;
  uppercaseLetter: boolean;
  specialCharacter: boolean;
};

export function checkAccountPassword(password: string): AccountPasswordChecks {
  return {
    minimumLength: [...password].length >= 8,
    uppercaseLetter: /\p{Lu}/u.test(password),
    specialCharacter: /[\p{P}\p{S}]/u.test(password),
  };
}

export function meetsAccountPasswordRequirements(password: string): boolean {
  const checks = checkAccountPassword(password);
  return password.length <= accountPasswordMaximumLength
    && checks.minimumLength && checks.uppercaseLetter && checks.specialCharacter;
}
