export const passwordMessages = {
  length: "Please use at least 8 characters.",
  lowercase: "Please include a lowercase letter.",
  capital: "Please include a capital letter.",
  number: "Please include a number.",
  symbol: "Please include a symbol, such as ! or @.",
  reused: "This matches a password you've used before. Please try a new one.",
  breach: "This password has appeared in a data breach. Please choose a new one.",
  unusable: "Please choose a different password.",
} as const;

/** Characters Supabase Auth accepts as the symbol class. A colon is included. */
export const passwordSymbols = "!@#$%^&*()_+-=[]{};':\"|<>?,./`~";

export function passwordIssue(password: string): string | null {
  if (password.length < 8) return passwordMessages.length;
  if (!/[a-z]/.test(password)) return passwordMessages.lowercase;
  if (!/[A-Z]/.test(password)) return passwordMessages.capital;
  if (!/[0-9]/.test(password)) return passwordMessages.number;
  if (![...password].some((character) => passwordSymbols.includes(character))) return passwordMessages.symbol;
  return null;
}
