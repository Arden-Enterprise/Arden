import { ReaderSummaryError } from "./summary-contracts.js";

/** Bounded process-local admission, not a distributed quota or persistent cache. */
export class ReaderAdmission {
  private readonly entries = new Map<string, { actor: string; active: boolean; until: number }>();
  constructor(private readonly now: () => number = Date.now, private readonly cooldownMs = 60_000) {}
  remaining(user: string, organization: string, publication = ""): number {
    return Math.max(0, Math.ceil(((this.entries.get(`${organization}:${user}:${publication}`)?.until ?? 0) - this.now()) / 1_000));
  }
  reserve(user: string, organization: string, publication = ""): {
    dispatch: () => void; release: (unsupported?: boolean) => void;
  } {
    const now = this.now(), actor = `${organization}:${user}`, key = `${actor}:${publication}`;
    for (const [id, entry] of this.entries) if (!entry.active && entry.until <= now) this.entries.delete(id);
    const entries = [...this.entries.values()];
    if (entries.some(entry => entry.actor === actor && entry.active))
      throw new ReaderSummaryError("BUSY", "IN_PROGRESS", 5);
    const previous = this.entries.get(key);
    if (previous) throw new ReaderSummaryError("BUSY", "COOLDOWN", Math.max(1, Math.ceil((previous.until - now) / 1_000)));
    if (entries.filter(entry => entry.active).length >= 8 || this.entries.size >= 1_000)
      throw new ReaderSummaryError("BUSY", "CAPACITY", 5);
    const entry = { actor, active: true, until: 0 };
    this.entries.set(key, entry);
    return { dispatch: () => { entry.until = this.now() + this.cooldownMs; },
      release: unsupported => { entry.active = false; if (unsupported || !entry.until) this.entries.delete(key); } };
  }
}
