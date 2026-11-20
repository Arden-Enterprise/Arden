import { useCallback, useEffect, useRef, useState } from "react";
import { matchesPublicationScope, type PublicationScope } from "@arden/domain";
import { listPublishedKnowledge, type PublishedKnowledge } from "../shared/api-client";
import type { Platform } from "../shared/types";

export type HomeSource = "organization" | "shared" | "other";
export type HomeSourceState = { items: PublishedKnowledge[]; status: "loading" | "ready" | "error" };
const scopes: Record<HomeSource, PublicationScope> = { organization: "ORGANIZATION", shared: "SHARED", other: "ALL_READABLE" };
const sources = Object.keys(scopes) as HomeSource[];
const empty = (): Record<HomeSource, HomeSourceState> => ({ organization: { items: [], status: "loading" },
  shared: { items: [], status: "loading" }, other: { items: [], status: "loading" } });

/** Scope compatibility check, not authorization: the API remains the reader authority. */
export function homeSourceItems(items: PublishedKnowledge[], source: HomeSource): PublishedKnowledge[] {
  if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== "string" || typeof item.draftId !== "string"
    || typeof item.title !== "string" || (item.targetReaders != null && !["ORGANIZATION", "DEPARTMENT", "SELECTED_MEMBERS"].includes(item.targetReaders.mode)))) {
    throw new Error("Invalid publication list");
  }
  if (source === "other") return items.filter(item => item.targetReaders == null);
  if (items.some(item => !matchesPublicationScope(item.targetReaders?.mode, scopes[source]))) throw new Error("Publication scope unavailable");
  return items;
}

export function useHomePublications(platform: Platform, organizationId: string) {
  const [views, setViews] = useState(empty);
  const generation = useRef(0), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; }; }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const current = () => live.current && request === generation.current;
    setViews(previous => Object.fromEntries(sources.map(source => [source, { ...previous[source], status: "loading" }])) as Record<HomeSource, HomeSourceState>);
    await Promise.all(sources.map(async source => {
      try {
        const items = homeSourceItems(await listPublishedKnowledge(platform, organizationId, scopes[source]), source);
        if (current()) setViews(previous => ({ ...previous, [source]: { items, status: "ready" } }));
      } catch {
        // A failed refresh must not leave previously readable titles/counts visible.
        if (current()) setViews(previous => ({ ...previous, [source]: { items: [], status: "error" } }));
      }
    }));
  }, [platform, organizationId]);
  const forget = useCallback((id: string) => {
    setViews(previous => Object.fromEntries(sources.map(source => [source, { ...previous[source],
      items: previous[source].items.filter(item => item.id !== id) }])) as Record<HomeSource, HomeSourceState>);
  }, []);
  return { views, refresh, forget };
}
