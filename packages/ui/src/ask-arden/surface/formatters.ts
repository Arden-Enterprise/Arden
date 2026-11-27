import {
  PROTOTYPE_DENYLIST,
  type BoundUiNode,
  type CalloutTone,
  type DocumentRelationshipType,
  type GovernanceFieldKey,
  type GraphReaderScope,
  type HydratedDocumentSummary,
  type SurfaceAction,
  type ValidityStatus,
} from "@arden/domain";
import type { IconName } from "../../shared/Icon";

export const defaultGovernanceFields: readonly GovernanceFieldKey[] = [
  "ownerDepartment",
  "authorDisplayName",
  "type",
  "version",
  "publishedAt",
  "validUntil",
  "validityStatus",
  "readerScope",
  "collectionName",
  "openMaintenanceCaseCount",
];

/** Prototype-safe own-property lookup used across surface nodes and hydration maps. */
export function safeGetOwn<T>(
  record: Readonly<Record<string, T>> | null | undefined,
  key: string,
): T | undefined {
  if (!record || typeof record !== "object" || PROTOTYPE_DENYLIST.has(key)) {
    return undefined;
  }
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function isSurfaceActionNode(node: BoundUiNode): node is SurfaceAction {
  return (
    node.kind === "graph_action" ||
    node.kind === "open_reader" ||
    node.kind === "workflow_handoff" ||
    node.kind === "prompt_chip"
  );
}

/**
 * Defense-in-depth client capability check mirroring Core hydrator filtering.
 * Fails closed whenever the version is unhydrated or the capability flag is false.
 */
export function isWorkflowHandoffAllowed(
  action: Extract<SurfaceAction, { kind: "workflow_handoff" }>,
  hydratedDocuments?: Readonly<Record<string, HydratedDocumentSummary>>,
): boolean {
  const doc = safeGetOwn(hydratedDocuments, action.publishedVersionId);
  if (!doc || doc.documentId !== action.documentId || doc.publishedVersionId !== action.publishedVersionId) return false;
  switch (action.handoff) {
    case "report_issue":
      return doc.canReportIssue === true;
    case "open_maintenance_case":
      return doc.canOpenMaintenance === true;
    case "open_renewal":
      return doc.canRenew === true;
    default: {
      const exhaustive: never = action.handoff;
      return exhaustive;
    }
  }
}

export function formatReaderScope(scope: GraphReaderScope): string {
  switch (scope) {
    case "ORGANIZATION":
      return "Everyone in organization";
    case "DEPARTMENT":
      return "Department";
    case "SELECTED_MEMBERS":
      return "Selected members";
    case "LEGACY_AUDIENCE":
      return "Custom audience";
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

export function formatValidityBadge(
  status: ValidityStatus,
  daysUntilExpiry: number | null,
): { label: string; detail: string | null; tone: "success" | "warning" | "danger"; icon: IconName } {
  switch (status) {
    case "Current":
      return { label: "Current", detail: null, tone: "success", icon: "check" };
    case "Expiring soon":
      return {
        label: "Expiring soon",
        detail: daysUntilExpiry !== null ? `${daysUntilExpiry}d left` : null,
        tone: "warning",
        icon: "warning",
      };
    case "Expired":
      return { label: "Expired", detail: null, tone: "danger", icon: "status-rejected" };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function formatGovernanceFieldLabel(field: GovernanceFieldKey): string {
  switch (field) {
    case "ownerDepartment":
      return "Owner department";
    case "authorDisplayName":
      return "Author";
    case "type":
      return "Type";
    case "version":
      return "Version";
    case "publishedAt":
      return "Published";
    case "validUntil":
      return "Valid until";
    case "validityStatus":
      return "Status";
    case "readerScope":
      return "Readers";
    case "collectionName":
      return "Collection";
    case "openMaintenanceCaseCount":
      return "Open maintenance cases";
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

export function formatRelationshipType(type: DocumentRelationshipType): string {
  switch (type) {
    case "REFERENCES":
      return "References";
    case "RELATED":
      return "Related";
    case "SUPERSEDES":
      return "Supersedes";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function formatCalloutMeta(tone: CalloutTone): { badge: string; icon: IconName } {
  switch (tone) {
    case "info":
      return { badge: "Info", icon: "book-open" };
    case "warning":
      return { badge: "Warning", icon: "warning" };
    case "gap":
      return { badge: "Gap", icon: "search" };
    case "conflict":
      return { badge: "Conflict", icon: "warning" };
    default: {
      const exhaustive: never = tone;
      return exhaustive;
    }
  }
}

const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatSurfaceDate(value: string | null): string {
  if (!value) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return value;
  return utcDateFormatter.format(new Date(parsed));
}
