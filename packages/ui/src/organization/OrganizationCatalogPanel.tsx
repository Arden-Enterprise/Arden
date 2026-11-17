import { useCallback, useEffect, useState } from "react";
import { ApiError, listPublishedKnowledge, loadKnowledgeCatalog,
  type KnowledgeCatalog, type PublishedKnowledge } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { KnowledgeCatalogEditor } from "../knowledge/KnowledgeCatalogEditor";

type Props = {
  platform: Platform;
  organizationId: string;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
};

export function OrganizationCatalogPanel({ platform, organizationId, onDirtyChange, onClose }: Props) {
  const [catalog, setCatalog] = useState<KnowledgeCatalog | null>(null);
  const [publications, setPublications] = useState<PublishedKnowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchCatalog = useCallback(async () => {
    const [nextCatalog, nextPublications] = await Promise.all([
      loadKnowledgeCatalog(platform, organizationId), listPublishedKnowledge(platform, organizationId),
    ]);
    if (!nextCatalog.canManage) throw new Error("Catalog management is unavailable for this account.");
    return { nextCatalog, nextPublications };
  }, [platform, organizationId]);

  const reload = useCallback(async () => {
    const { nextCatalog, nextPublications } = await fetchCatalog();
    setCatalog(nextCatalog);
    setPublications(nextPublications);
  }, [fetchCatalog]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void fetchCatalog().then(({ nextCatalog, nextPublications }) => {
      if (!active) return;
      setCatalog(nextCatalog); setPublications(nextPublications);
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message
        : cause instanceof Error ? cause.message : "Catalog is unavailable. Refresh and try again.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchCatalog]);

  if (loading) return <div className="island island-empty" role="status">Loading Topics…</div>;
  if (error || !catalog) return <div className="organization-notice is-danger" role="alert">
    <strong>Topics are unavailable.</strong><span>{error || "Refresh and try again."}</span>
    <button type="button" className="secondary-button" onClick={() => {
      setLoading(true); setError("");
      void reload().catch((cause) => setError(cause instanceof ApiError ? cause.message
        : "Catalog is unavailable. Refresh and try again.")).finally(() => setLoading(false));
    }}>Try again</button>
  </div>;

  return <KnowledgeCatalogEditor platform={platform} organizationId={organizationId}
    catalog={catalog} publications={publications} onSaved={reload} onClose={onClose}
    backLabel="Back to Administration" onDirtyChange={onDirtyChange} />;
}
