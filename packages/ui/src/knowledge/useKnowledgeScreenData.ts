import { useCallback, useEffect, useRef, useState } from "react";
import {
  listKnowledgeDrafts, listKnowledgeReviewBoard, listKnowledgeSubmissions,
  listPublicationRenewals, loadKnowledgeCatalog, loadKnowledgeOptions,
} from "../shared/api-client";
import type { Platform } from "../shared/types";

type RequestState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: unknown };

/** A screen owns its refresh. Late responses from an older refresh or an exited screen are ignored. */
function useScreenRequest<T>(enabled: boolean, load: () => Promise<T>) {
  const [state, setState] = useState<RequestState<T>>({ status: "loading" });
  const latest = useRef(0);
  const active = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !active.current) return;
    const request = ++latest.current;
    setState(current => current.status === "error" ? { status: "loading" } : current);
    try {
      const data = await load();
      if (request === latest.current) setState({ status: "ready", data });
    } catch (error) {
      if (request === latest.current) setState({ status: "error", error });
    }
  }, [enabled, load]);
  useEffect(() => {
    active.current = enabled;
    void refresh();
    return () => { active.current = false; latest.current++; };
  }, [enabled, refresh]);
  return {
    data: state.status === "ready" ? state.data : undefined,
    error: state.status === "error" ? state.error : null,
    loading: state.status === "loading",
    refresh,
  };
}

export function useKnowledgeScreenData(platform: Platform, organizationId: string, scopes: {
  reviews: boolean;
  contributions: boolean;
  documentOwnership: boolean;
  contributionList: boolean;
  home: boolean;
  metadata: boolean;
}) {
  const reviewBoard = useScreenRequest(scopes.reviews, useCallback(
    () => listKnowledgeReviewBoard(platform, organizationId), [platform, organizationId],
  ));
  const drafts = useScreenRequest(scopes.contributions || scopes.documentOwnership,
    useCallback(() => listKnowledgeDrafts(platform, organizationId), [platform, organizationId]));
  const submissions = useScreenRequest(scopes.contributions, useCallback(
    () => listKnowledgeSubmissions(platform, organizationId), [platform, organizationId],
  ));
  const refreshContributions = useCallback(async () => {
    await Promise.all([drafts.refresh(), submissions.refresh()]);
  }, [drafts.refresh, submissions.refresh]);
  const contributions = {
    data: drafts.data && submissions.data ? { drafts: drafts.data, submissions: submissions.data } : undefined,
    error: drafts.error || submissions.error,
    loading: (drafts.loading || submissions.loading) && !(drafts.error || submissions.error),
    refresh: refreshContributions,
  };
  const renewals = useScreenRequest(scopes.contributionList, useCallback(async () => {
    const items = await listPublicationRenewals(platform, organizationId);
    return new Map(items.filter(item => item.isAuthor).map(item => [item.documentId, item]));
  }, [platform, organizationId]));
  const catalog = useScreenRequest(scopes.home, useCallback(
    () => loadKnowledgeCatalog(platform, organizationId), [platform, organizationId],
  ));
  // Department labels can arrive after the board. A slow lookup must not block the review queue.
  const options = useScreenRequest(scopes.metadata || (scopes.reviews && Boolean(reviewBoard.data)),
    useCallback(() => loadKnowledgeOptions(platform, organizationId), [platform, organizationId]));
  return { reviewBoard, contributions, drafts, renewals, catalog, options };
}
