import { useEffect, useState } from "react";
import { ApiError, listPublicationRenewals, loadResponsiblePublication, type GovernanceDocument,
  type PublicationRenewalState } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { GovernanceContentDialog } from "./PublicationGovernance";
import { RenewPublicationDialog } from "./RenewPublicationDialog";

export type GovernanceActionTarget = {
  kind: "responsible" | "renewal";
  documentId: string;
  publishedVersionId: string;
  title: string;
};

/** Reads the live exact-version gate before opening a responsible view or the renewal form. */
export function GovernanceActionDialog({ target, platform, organizationId, onClose, onSent }: {
  target: GovernanceActionTarget;
  platform: Platform;
  organizationId: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { kind, documentId, publishedVersionId, title } = target;
  const [document, setDocument] = useState<GovernanceDocument | null>(null);
  const [renewal, setRenewal] = useState<PublicationRenewalState | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (kind === "responsible") {
          const loaded = await loadResponsiblePublication(platform, organizationId, documentId);
          if (loaded.documentId !== documentId || loaded.publishedVersionId !== publishedVersionId) {
            if (active) setError("This version is no longer available.");
          } else if (active) setDocument(loaded);
        } else {
          const states = await listPublicationRenewals(platform, organizationId);
          const current = states.find((state) => state.documentId === documentId
            && state.publishedVersionId === publishedVersionId && state.canRenew && !state.renewalPending);
          if (current) {
            if (active) setRenewal(current);
          } else if (active) setError("Renewal is unavailable for this version.");
        }
      } catch (cause) {
        if (active) setError(cause instanceof ApiError ? cause.message : "Couldn’t open this document action.");
      }
    };
    void load();
    return () => { active = false; };
  }, [documentId, kind, organizationId, platform, publishedVersionId, retry]);

  if (document) {
    return <GovernanceContentDialog document={document} heading="Responsible reviewer view" onClose={onClose} />;
  }
  if (renewal) {
    return <RenewPublicationDialog platform={platform} organizationId={organizationId} target={renewal}
      onClose={onClose} onSent={() => { onClose(); onSent?.(); }} />;
  }
  return <KnowledgeDialog title={title} subtitle={kind === "responsible" ? "Responsible reviewer view" : "Renew document"}
    onClose={onClose}>
    {error ? <>
      <p role="alert" className="knowledge-live-error">{error}</p>
      <button type="button" className="secondary-button" onClick={() => { setError(""); setRetry((count) => count + 1); }}>
        Retry
      </button>
    </> : <p role="status">Checking document access…</p>}
  </KnowledgeDialog>;
}
