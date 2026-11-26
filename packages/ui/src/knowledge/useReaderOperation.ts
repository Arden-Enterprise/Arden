import { useEffect, useRef, useState } from "react";
import { ApiError } from "../shared/api-client";
import type { ReaderSummaryContext } from "../shared/reader-summary-contracts";
import type { Platform } from "../shared/types";
import type { KnowledgeCitationReference } from "./knowledgeCitation";
import { ReaderAccessInterrupted, type ReaderAccessSession } from "./useReaderAccess";

export type ReaderOperationOptions = { platform: Platform; context: ReaderSummaryContext; active: boolean; visible?: boolean;
  onCitation: (citation: KnowledgeCitationReference | null) => void; onAccessLost: () => void };
type State<Result> = { key: string | null; status: "closed" | "loading" | "checking" | "paused" | "ready" | "error";
  result?: Result; message?: string; retry?: boolean; retryAt?: number };

/** Ephemeral exact-reader state. A delivered derivative is never a reusable read grant. */
export function useReaderOperation<Result, Input>(options: ReaderOperationOptions | undefined, access: ReaderAccessSession, config: {
  label: string; busyRetrySeconds?: number; run: (options: ReaderOperationOptions, input: Input, signal: AbortSignal) => Promise<Result>;
}) {
  const key = access.key;
  const visible = options?.visible !== false;
  const current = useRef({ key, options, config, access }); current.current = { key, options, config, access };
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const operation = useRef<"generate" | "check" | null>(null);
  const candidate = useRef<{ key: string; result: Result } | null>(null);
  const lastInput = useRef<{ value: Input } | null>(null);
  const [stored, setState] = useState<State<Result>>({ key: null, status: "closed" });
  const [clock, setClock] = useState(Date.now);
  const scoped: State<Result> = key && stored.key === key ? stored : { key, status: "closed" };
  const state: State<Result> = scoped.status === "ready" && (access.hidden || access.needsCheck)
    ? { key, status: access.hidden ? "paused" : "checking" } : scoped;
  const valid = (scope: string, ticket: number) => current.current.key === scope && sequence.current === ticket;
  const invalidate = () => { sequence.current++; controller.current?.abort(); controller.current = null; operation.current = null; };
  const close = () => {
    invalidate(); candidate.current = null; lastInput.current = null; setState({ key: current.current.key, status: "closed" });
    current.current.options?.onCitation(null);
  };
  const failure = (cause: unknown, scope: string) => {
    const status = cause instanceof ApiError ? cause.status : 0;
    const denied = status === 401 || status === 403 || status === 404;
    const unsupported = status === 422;
    const retryable = !denied && !unsupported && (!(cause instanceof ApiError) || cause.retryable !== false);
    const retryAfterSeconds = cause instanceof ApiError ? cause.retryAfterSeconds ?? (status === 429 ? config.busyRetrySeconds ?? 60 : 0) : 0;
    const code = cause instanceof ApiError ? cause.code : null;
    if (denied || unsupported) candidate.current = null;
    const now = Date.now(); setClock(now);
    setState({ key: scope, status: "error", retry: retryable, retryAt: now + retryAfterSeconds * 1_000,
      message: denied ? "This document is unavailable." : unsupported ? `${config.label} is unavailable for this document.`
        : code === "SUMMARY_IN_PROGRESS" ? "Another summary is still running."
        : code === "SUMMARY_COOLDOWN" ? "Please wait before creating another summary."
        : code === "SUMMARY_CAPACITY" || code === "SUMMARY_PROVIDER_BUSY" ? "Arden is busy. Please retry shortly."
        : code === "SUMMARY_SOURCE_UNAVAILABLE" ? "Summary is unavailable. Please retry shortly."
        : code === "SUMMARY_TIMEOUT" ? "Summary took too long. Please retry."
        : !retryable ? `${config.label} is unavailable.`
        : status === 429 ? "Wait a moment, then retry." : `${config.label} is unavailable. Please retry.` });
    if (denied || unsupported) current.current.options?.onCitation(null);
    if (denied && current.current.access.deny()) current.current.options?.onAccessLost();
  };
  useEffect(() => {
    if (stored.status !== "error" || !stored.retry || !stored.retryAt || stored.retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      const now = Date.now(); setClock(now);
      if (now >= stored.retryAt!) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [stored.status, stored.retry, stored.retryAt]);
  const open = async (input: Input) => {
    const { key: scope, options: settings, config: operationConfig } = current.current;
    if (!scope || !settings || operation.current) return;
    invalidate(); candidate.current = null; lastInput.current = { value: input };
    const ticket = sequence.current, abort = new AbortController(); controller.current = abort;
    operation.current = "generate"; setState({ key: scope, status: "loading" });
    try {
      const result = await operationConfig.run(settings, input, abort.signal);
      if (!valid(scope, ticket)) return;
      candidate.current = { key: scope, result };
      setState({ key: scope, status: "ready", result });
    } catch (cause) { if (valid(scope, ticket)) failure(cause, scope); }
    finally { if (valid(scope, ticket)) operation.current = null; }
  };
  const check = async (citation?: KnowledgeCitationReference) => {
    const { key: scope, options: config } = current.current, saved = candidate.current;
    if (!scope || !config || saved?.key !== scope || operation.current) return;
    invalidate(); const ticket = sequence.current;
    operation.current = "check"; setState({ key: scope, status: "checking" });
    try {
      await current.current.access.check(Boolean(citation));
      if (!valid(scope, ticket)) return;
      setState({ key: scope, status: "ready", result: saved.result });
      if (citation) config.onCitation(citation);
    } catch (cause) {
      if (valid(scope, ticket)) {
        if (cause instanceof ReaderAccessInterrupted) setState({ key: scope, status: "ready", result: saved.result });
        else failure(cause, scope);
      }
    }
    finally { if (valid(scope, ticket)) operation.current = null; }
  };
  const latestCheck = useRef(check); latestCheck.current = check;
  useEffect(() => {
    // Clear the rendered state as well as refs: A → B → A must not revive A's old result.
    setState({ key, status: "closed" });
    return () => {
      invalidate(); candidate.current = null; lastInput.current = null;
      options?.onCitation(null);
    };
  }, [key]);
  useEffect(() => {
    if (visible && !access.hidden && access.needsCheck && stored.status === "ready"
      && candidate.current?.key === key) void latestCheck.current();
  }, [key, visible, access.hidden, access.needsCheck, stored.status]);
  return { state, open, close, navigate: check, retryAfterSeconds: Math.max(0, Math.ceil(((state.retryAt ?? 0) - clock) / 1_000)),
    retry: () => {
      if (state.status !== "error" || !state.retry || (state.retryAt ?? 0) > Date.now()) return;
      return candidate.current?.key === key ? check() : lastInput.current ? open(lastInput.current.value) : undefined;
    } };
}
