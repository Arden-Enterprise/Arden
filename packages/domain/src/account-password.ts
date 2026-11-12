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
  return checks.minimumLength && checks.uppercaseLetter && checks.specialCharacter;
}
