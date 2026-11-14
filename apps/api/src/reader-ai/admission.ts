import { ReaderSummaryError } from "./summary-contracts.js";

/** Bounded process-local admission, not a distributed quota or persistent cache. */
export class ReaderAdmission {
  private readonly entries = new Map<string, { active: boolean; until: number }>();
  constructor(private readonly now: () => number = Date.now, private readonly cooldownMs = 60_000) {}
  reserve(user: string, organization: string): { dispatch: () => void; release: () => void } {
    const now = this.now(), key = `${organization}:${user}`;
    for (const [id, entry] of this.entries) if (!entry.active && entry.until <= now) this.entries.delete(id);
    if (this.entries.has(key) || [...this.entries.values()].filter(entry => entry.active).length >= 8
      || this.entries.size >= 1_000) throw new ReaderSummaryError("BUSY");
    const entry = { active: true, until: 0 };
    this.entries.set(key, entry);
    return { dispatch: () => { entry.until = this.now() + this.cooldownMs; },
      release: () => { entry.active = false; if (!entry.until) this.entries.delete(key); } };
  }
}
