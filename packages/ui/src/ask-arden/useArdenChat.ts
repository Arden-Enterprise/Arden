import { useEffect, useRef, useState } from "react";
import type { HydratedDocumentSummary } from "@arden/domain";
import { ApiError, askArden, listAiConversations, loadAiConversation, rateAiAnswer, type AiConversation, type AnswerFeedback,
  type AiConversationSummary } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { askPrivateNote, ratePrivateAnswer } from "../shared/private-workspace-api";
import {
  answerMessage,
  mergeHydratedDocuments,
  parseHydratedDocuments,
  parseTurnHydration,
  type AnswerCitation,
  type AskArdenMessage,
} from "./askArdenModel";

export type ArdenChat = ReturnType<typeof useArdenChat>;

export type ChatSource =
  | { kind: "company" }
  | { kind: "private-note"; id: string; version: number; title: string }
  | { kind: "private-empty"; hint: string };

function savedMessages(saved: AiConversation): AskArdenMessage[] {
  return saved.turns.flatMap((turn) => {
    const unavailable = turn.status === "UNAVAILABLE";
    const uiSurface = !unavailable && turn.uiSurface && typeof turn.uiSurface === "object" && !Array.isArray(turn.uiSurface)
      ? turn.uiSurface : null;
    const turnHydration = !unavailable ? parseTurnHydration(turn.turnHydration) : null;
    return [
      { id: `${turn.id}-question`, role: "member", body: turn.question },
      { id: turn.id, role: "assistant", body: turn.answer, citations: turn.citations,
        ...(uiSurface ? { uiSurface } : {}),
        ...(turnHydration ? { turnHydration } : {}),
        savedTurn: { conversationId: saved.id, turnId: turn.id }, feedback: turn.feedback,
        insufficientEvidence: turn.status === "INSUFFICIENT_EVIDENCE", unavailable },
    ];
  });
}

function earlierCursor(saved: AiConversation): number | null {
  const sequence = saved.turns[0]?.sequence;
  return saved.hasMore && typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 1 ? sequence : null;
}

export function useArdenChat({ platform, organizationId, source, sessionKey, scopeDocumentIds }: {
  platform: Platform; organizationId: string | null; source: ChatSource; sessionKey?: string; scopeDocumentIds?: ReadonlySet<string>;
}) {
  const canAsk = Boolean(organizationId) && source.kind !== "private-empty";
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AskArdenMessage[]>([]);
  const [hydratedDocuments, setHydratedDocuments] = useState<Record<string, HydratedDocumentSummary>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AiConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<{ cursor: number; loading: boolean; error: string | null } | null>(null);
  const earlierRequest = useRef<symbol | null>(null);
  const [sources, setSources] = useState<{ messageId: string; citation: AnswerCitation | null } | null>(null);
  const sourcesOpener = useRef<HTMLElement | null>(null);
  const conversation = useRef<{ id: string; revision: number }>({ id: crypto.randomUUID(), revision: 0 });
  const retryRequest = useRef<{ query: string; id: string; conversationId: string; revision: number; scopeKey: string } | null>(null);
  const pendingQuestion = useRef<{ id: string; query: string } | null>(null);
  const requestGeneration = useRef(0);

  useEffect(() => {
    requestGeneration.current++;
    earlierRequest.current = null;
    conversation.current = { id: crypto.randomUUID(), revision: 0 };
    retryRequest.current = null;
    setMessages([]); setHydratedDocuments({}); setDraft(""); setError(null); setPending(false);
    setHistoryOpen(false); setHistoryLoading(false); setHistory([]); setHistoryError(null); setOpeningId(null);
    setSources(null); setSavedTitle(null); setEarlier(null);
    return () => { requestGeneration.current++; earlierRequest.current = null; };
  }, [organizationId, sessionKey]);

  const showConversation = (saved: AiConversation) => {
    conversation.current = { id: saved.id, revision: saved.revision };
    earlierRequest.current = null;
    const cursor = earlierCursor(saved);
    setEarlier(cursor === null ? null : { cursor, loading: false, error: null });
    setSavedTitle(saved.title);
    setSources(null);
    setHydratedDocuments(parseHydratedDocuments(saved.hydratedDocuments));
    setMessages(savedMessages(saved));
  };

  const loadEarlier = async () => {
    if (!organizationId || source.kind !== "company" || pending || historyLoading || !earlier || earlierRequest.current) return;
    const id = conversation.current.id;
    const { cursor } = earlier;
    const request = Symbol();
    earlierRequest.current = request;
    setEarlier({ cursor, loading: true, error: null });
    try {
      const saved = await loadAiConversation(platform, organizationId, id, { beforeSequence: cursor });
      if (earlierRequest.current !== request) return;
      if (saved.id !== id || saved.turns.some((turn) => turn.sequence >= cursor)) throw new Error("Invalid conversation page.");
      const previous = savedMessages(saved);
      setMessages((current) => [...previous, ...current]);
      setHydratedDocuments((current) => mergeHydratedDocuments(current, saved.hydratedDocuments));
      const next = earlierCursor(saved);
      setEarlier(next === null ? null : { cursor: next, loading: false, error: null });
    } catch (cause) {
      if (earlierRequest.current === request) {
        const message = cause instanceof ApiError ? cause.message : "Earlier messages could not be loaded.";
        setEarlier({ cursor, loading: false, error: message });
      }
    } finally {
      if (earlierRequest.current === request) earlierRequest.current = null;
    }
  };

  /** Opens a saved chat from History, or reloads the current one; an error stays where the request started. */
  const openConversation = async (id: string, fromHistory = false): Promise<boolean> => {
    if (!organizationId || pending || source.kind !== "company") return false;
    const generation = ++requestGeneration.current;
    // Reloading the open chat keeps an unsent follow-up; switching chats starts from an empty draft.
    const sameChat = id === conversation.current.id;
    setHistoryLoading(true); setOpeningId(fromHistory ? id : null);
    if (fromHistory) setHistoryError(null); else setError(null);
    try {
      const saved = await loadAiConversation(platform, organizationId, id);
      if (generation !== requestGeneration.current) return false;
      showConversation(saved); if (!sameChat) setDraft(""); setError(null); retryRequest.current = null; setHistoryOpen(false);
      return true;
    } catch (cause) {
      if (generation !== requestGeneration.current) return false;
      const message = cause instanceof ApiError ? cause.message : "Chat could not be opened.";
      if (fromHistory) setHistoryError(message); else setError(message);
      return false;
    } finally { if (generation === requestGeneration.current) { setHistoryLoading(false); setOpeningId(null); } }
  };

  const loadHistory = async () => {
    if (!organizationId || source.kind !== "company") return;
    const generation = ++requestGeneration.current;
    setHistoryLoading(true); setHistoryError(null);
    try {
      const saved = await listAiConversations(platform, organizationId);
      if (generation === requestGeneration.current) setHistory(saved);
    } catch (cause) {
      if (generation === requestGeneration.current) setHistoryError(cause instanceof ApiError ? cause.message : "History is unavailable.");
    } finally { if (generation === requestGeneration.current) setHistoryLoading(false); }
  };

  const openHistory = () => {
    if (!organizationId || pending || source.kind !== "company") return;
    setHistoryOpen(true); void loadHistory();
  };

  const closeHistory = () => { requestGeneration.current++; setHistoryOpen(false); setHistoryLoading(false); setOpeningId(null); };

  /** Shows an answer's sources beside the chat; Open in document stays the governed reader path. */
  const showSources = (messageId: string, opener: HTMLElement, citation: AnswerCitation | null = null) => {
    sourcesOpener.current = opener;
    setSources({ messageId, citation });
  };
  const closeSources = () => {
    const opener = sourcesOpener.current;
    sourcesOpener.current = null;
    setSources(null);
    requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); });
  };
  const sourceMessage = sources ? messages.find((message) => message.id === sources.messageId) : undefined;
  const sourcePanel = sources && sourceMessage?.citations?.length
    ? { messageId: sources.messageId, citations: sourceMessage.citations, selected: sources.citation } : null;

  const rateAnswer = async (message: AskArdenMessage, feedback: AnswerFeedback) => {
    if (!organizationId) throw new Error("This answer cannot be rated.");
    const { savedTurn, privateFeedbackToken } = message;
    const result = source.kind === "private-note" && privateFeedbackToken
      ? await ratePrivateAnswer(platform, organizationId, privateFeedbackToken, feedback)
      : source.kind === "company" && savedTurn
        ? await rateAiAnswer(platform, organizationId, savedTurn.conversationId, savedTurn.turnId, feedback)
        : null;
    if (!result) throw new Error("This answer cannot be rated.");
    setMessages((current) => current.map((entry) => entry.id === message.id ? { ...entry, feedback: result.feedback } : entry));
  };

  const submit = async () => {
    const query = draft.trim();
    if (!query || pending || !organizationId || source.kind === "private-empty") return;
    const generation = ++requestGeneration.current;
    setHistoryLoading(false);
    const last = messages.at(-1);
    const questionId = last?.role === "member" && last.body === query ? last.id : crypto.randomUUID();
    pendingQuestion.current = { id: questionId, query };
    // A different prompt replaces an earlier unsent one; resending the same text retries it in place.
    setMessages((current) => {
      const kept = current.filter((message) => !message.unsent || message.id === questionId)
        .map((message) => message.id === questionId ? { ...message, unsent: false } : message);
      return kept.some((message) => message.id === questionId) ? kept : [...kept, { id: questionId, role: "member", body: query }];
    });
    setDraft("");
    setError(null);
    setPending(true);
    try {
      if (source.kind === "private-note") {
        const answer = await askPrivateNote(platform, organizationId, source.id, source.version, query, crypto.randomUUID());
        if (generation === requestGeneration.current) {
          setMessages((current) => [...current, answerMessage(answer, crypto.randomUUID())]);
        }
        return;
      }
      const previous = retryRequest.current;
      const conversationId = conversation.current.id;
      const documentIds = [...(scopeDocumentIds ?? [])].sort();
      const scopeKey = documentIds.join(",");
      // A retry replays the original turn, so it keeps the revision it was first sent with.
      const retry = previous?.query === query && previous.conversationId === conversationId && previous.scopeKey === scopeKey
        ? previous : null;
      const requestId = retry?.id ?? crypto.randomUUID();
      const expectedRevision = retry?.revision ?? conversation.current.revision;
      retryRequest.current = { query, id: requestId, conversationId, revision: expectedRevision, scopeKey };
      const answer = await askArden(platform, organizationId, query, {
        conversationId, expectedRevision, requestId,
        ...(documentIds.length > 0 ? { scopeFilter: { documentIds } } : {}),
      });
      if (generation !== requestGeneration.current) {
        // A stopped request can still commit; keep the revision so the next prompt does not conflict.
        if (answer.conversationId === conversationId && conversation.current.id === conversationId
          && answer.revision !== undefined && answer.revision > conversation.current.revision) {
          conversation.current = { id: conversationId, revision: answer.revision };
        }
        return;
      }
      if (!answer.conversationId || answer.revision === undefined) throw new Error("Conversation persistence is unavailable.");
      conversation.current = { id: answer.conversationId, revision: answer.revision };
      retryRequest.current = null;
      const answerId = answer.turnId ?? crypto.randomUUID();
      if (answer.hydratedDocuments) {
        setHydratedDocuments((current) => mergeHydratedDocuments(current, answer.hydratedDocuments));
      }
      setMessages((current) => [...current, answerMessage(answer, answerId)]);
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(cause instanceof ApiError ? cause.message : "Ask Arden could not prepare an answer.");
        // Not answered: mark the prompt unsent and offer it again without overwriting newer text.
        setMessages((current) => current.map((message) => message.id === questionId ? { ...message, unsent: true } : message));
        setDraft((current) => current || query);
      }
    } finally {
      if (generation === requestGeneration.current) { setPending(false); pendingQuestion.current = null; }
    }
  };

  const reset = () => {
    requestGeneration.current++;
    earlierRequest.current = null;
    setPending(false);
    setHistoryLoading(false);
    setDraft("");
    setMessages([]);
    setHydratedDocuments({});
    setError(null);
    setSources(null);
    setSavedTitle(null);
    setEarlier(null);
    pendingQuestion.current = null;
    conversation.current = { id: crypto.randomUUID(), revision: 0 }; retryRequest.current = null;
  };

  const stopWaiting = () => {
    // This dismisses the local wait, not the provider's already-started work or cost.
    const question = pendingQuestion.current;
    requestGeneration.current++; pendingQuestion.current = null;
    setPending(false); setError(null);
    if (question) {
      setMessages((current) => current.filter((message) => message.id !== question.id));
      setDraft((current) => current ? `${question.query}\n\n${current}` : question.query);
    }
  };

  return {
    draft, setDraft, messages, hydratedDocuments, pending, error, history, historyOpen, historyLoading,
    historyError, openingId, sourcePanel, earlier, loadEarlier,
    empty: messages.length === 0,
    currentId: messages.length ? conversation.current.id : null,
    threadTitle: savedTitle ?? messages.find((message) => message.role === "member")?.body ?? "New conversation",
    canAsk, privateNote: source.kind !== "company",
    submit, reset, stopWaiting, openHistory, closeHistory, openConversation, loadHistory, showSources, closeSources, rateAnswer,
    toggleHistory: () => { if (historyOpen) closeHistory(); else openHistory(); },
    reloadConversation: () => openConversation(conversation.current.id),
  };
}
