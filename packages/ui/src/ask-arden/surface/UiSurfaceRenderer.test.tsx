// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BoundUiSurface,
  HydratedDocumentSummary,
  SurfaceAction,
  TurnHydration,
} from "@arden/domain";
import * as api from "../../shared/api-client";
import type { AnswerCitation } from "../askArdenModel";
import { AskArdenPage } from "../AskArdenPage";
import { useArdenChat } from "../useArdenChat";
import { AgentPanel } from "../../app/AgentPanel";
import { installTestDialogs } from "../../../tests/dialogTestSupport";
import { UiSurfaceRenderer } from "./UiSurfaceRenderer";

async function readLocalText(relativePath: string): Promise<string> {
  const fsSpecifier = "node:fs";
  const fs = (await import(/* @vite-ignore */ fsSpecifier)) as {
    readFileSync: (path: URL, encoding: "utf8") => string;
  };
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const DOC_1 = "11111111-1111-4111-8111-111111111111";
const VER_1 = "22222222-2222-4222-8222-222222222222";
const DOC_2 = "33333333-3333-4333-8333-333333333333";
const VER_2 = "44444444-4444-4444-8444-444444444444";
const DOC_3 = "55555555-5555-4555-8555-555555555555";
const VER_3 = "66666666-6666-4666-8666-666666666666";
const DEPT_1 = "77777777-7777-4777-8777-777777777777";

const citation1: AnswerCitation = {
  documentId: DOC_1,
  versionId: VER_1,
  blockId: "blk-1",
  page: 2,
  excerpt: "Access requests must be submitted five working days in advance.",
  title: "Access Control Standard",
  version: "2.1",
  scope: "Organization",
  classification: "INTERNAL",
};

const citation2: AnswerCitation = {
  documentId: DOC_2,
  versionId: VER_2,
  blockId: "blk-2",
  page: 4,
  excerpt: "Contractor onboarding requires IT Security sign-off.",
  title: "Contractor Onboarding Guide",
  version: "1.4",
  scope: "Department",
  classification: "INTERNAL",
};

function makeHydratedDoc(
  overrides: Partial<HydratedDocumentSummary> = {},
): HydratedDocumentSummary {
  return {
    documentId: DOC_1,
    publishedVersionId: VER_1,
    title: "Access Control Standard",
    type: "Policy & Standard",
    version: "2.1",
    ownerDepartmentId: DEPT_1,
    ownerDepartmentName: "Information Security",
    authorDisplayName: "Linh Tran",
    publishedAt: "2026-10-15T09:00:00Z",
    validUntil: "2026-12-10",
    validityStatus: "Expiring soon",
    daysUntilExpiry: 14,
    readerScope: "ORGANIZATION",
    collectionName: "Security Baseline",
    openMaintenanceCaseCount: 2,
    openTarget: "READER",
    canReportIssue: true,
    canOpenMaintenance: true,
    canRenew: true,
    ...overrides,
  };
}

let restoreDialogs: () => void;

beforeEach(() => {
  restoreDialogs = installTestDialogs();
});

afterEach(() => {
  cleanup();
  restoreDialogs();
  vi.restoreAllMocks();
});

describe("UiSurfaceRenderer — containers, leaves, and actions", () => {
  it("renders all 6 containers, 7 leaves, and 4 allowlisted actions cleanly with zero raw links", () => {
    const hydratedDocuments: Record<string, HydratedDocumentSummary> = {
      [VER_1]: makeHydratedDoc(),
      [VER_2]: makeHydratedDoc({
        documentId: DOC_2,
        publishedVersionId: VER_2,
        title: "Contractor Onboarding Guide",
        type: null,
        version: "1.4",
        ownerDepartmentName: "People Operations",
        authorDisplayName: null,
        validUntil: null,
        validityStatus: "Current",
        daysUntilExpiry: null,
        readerScope: "DEPARTMENT",
        collectionName: null,
        openMaintenanceCaseCount: 0,
        canReportIssue: true,
        canOpenMaintenance: true,
        canRenew: true,
      }),
    };

    const turnHydration: TurnHydration = {
      metrics: {
        metrics_1: [
          { key: "MATCHED_DOCS", label: "Matched documents", value: 2, tone: "neutral" },
          { key: "EXPIRING_SOON_DOCS", label: "Expiring soon", value: 1, tone: "warning" },
          { key: "OPEN_MAINTENANCE_CASES", label: "Open cases", value: 2, tone: "attention" },
        ],
      },
      lineages: {
        lineage_1: {
          rootDocumentId: DOC_1,
          edges: [
            {
              relationshipId: "rel-1",
              direction: "OUTGOING",
              relationshipType: "REFERENCES",
              peerDocumentId: DOC_2,
              peerPublishedVersionId: VER_2,
              peerTitle: "Contractor Onboarding Guide",
              peerType: null,
            },
            {
              relationshipId: "rel-2",
              direction: "INCOMING",
              relationshipType: "SUPERSEDES",
              peerDocumentId: DOC_3,
              peerPublishedVersionId: VER_3,
              peerTitle: "Legacy Access Policy 1.0",
              peerType: "Policy & Standard",
            },
          ],
        },
      },
    };

    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: {
          kind: "stack",
          gap: "md",
          childIds: [
            "metrics_1",
            "intro_prose",
            "row_docs",
            "callout_conflict",
            "table_compare",
            "tabs_main",
            "section_lineage",
          ],
        },
        metrics_1: {
          kind: "metric_strip",
          metricKeys: ["MATCHED_DOCS", "EXPIRING_SOON_DOCS", "OPEN_MAINTENANCE_CASES"],
        },
        intro_prose: {
          kind: "prose",
          markdown: "**Access review** requires five working days notice [1].",
          citationIndexes: [1],
        },
        row_docs: {
          kind: "row",
          columns: 2,
          childIds: ["card_doc1", "card_doc2"],
        },
        card_doc1: {
          kind: "card",
          title: "Primary Standard",
          subtitle: "Core-hydrated governance record",
          tone: "default",
          bodyIds: ["doc_item_1"],
          footerIds: ["act_graph", "act_reader", "act_handoff", "act_prompt"],
        },
        doc_item_1: {
          kind: "document_item",
          documentId: DOC_1,
          publishedVersionId: VER_1,
          highlightNote: "Covers the five-day lead time requirement.",
        },
        act_graph: {
          kind: "graph_action",
          label: "Inspect in Graph",
          action: { op: "focus_nodes", documentIds: [DOC_1] },
        },
        act_reader: {
          kind: "open_reader",
          label: "Open policy",
          documentId: DOC_1,
          publishedVersionId: VER_1,
          page: 2,
        },
        act_handoff: {
          kind: "workflow_handoff",
          label: "Report issue",
          handoff: "report_issue",
          documentId: DOC_1,
          publishedVersionId: VER_1,
        },
        act_prompt: {
          kind: "prompt_chip",
          label: "Compare contractor rules",
          prompt: "Compare contractor access rules against full-time employees.",
        },
        card_doc2: {
          kind: "card",
          tone: "subtle",
          bodyIds: ["doc_item_2"],
        },
        doc_item_2: {
          kind: "document_item",
          documentId: DOC_2,
          publishedVersionId: VER_2,
        },
        callout_conflict: {
          kind: "callout",
          tone: "conflict",
          title: "Lead-time difference",
          body: "Standard employees need 5 days while contractors also need IT Security sign-off.",
          citationIndexes: [1, 2],
        },
        table_compare: {
          kind: "comparison_table",
          caption: "Access policy comparison",
          columns: ["Requirement", "Rule"],
          rows: [
            {
              cells: [
                { text: "Lead time" },
                { text: "5 working days", citationIndexes: [1] },
              ],
            },
            {
              cells: [
                { text: "Contractors" },
                { text: "IT Security sign-off", citationIndexes: [2] },
              ],
            },
          ],
        },
        tabs_main: {
          kind: "tabs",
          defaultTabId: "tab_split",
          tabs: [
            { id: "tab_split", label: "Side by side", childIds: ["split_gov"] },
            { id: "tab_notes", label: "Summary", childIds: ["tab_prose"] },
          ],
        },
        split_gov: {
          kind: "split",
          leftTitle: "Standard Governance",
          leftId: "card_gov_left",
          rightTitle: "Guide Governance",
          rightId: "card_gov_right",
        },
        card_gov_left: {
          kind: "card",
          bodyIds: ["gov_1"],
        },
        gov_1: {
          kind: "governance_kv",
          documentId: DOC_1,
          publishedVersionId: VER_1,
        },
        card_gov_right: {
          kind: "card",
          bodyIds: ["gov_2"],
        },
        gov_2: {
          kind: "governance_kv",
          documentId: DOC_2,
          publishedVersionId: VER_2,
        },
        tab_prose: {
          kind: "prose",
          markdown: "Secondary summary tab content [2].",
          citationIndexes: [2],
        },
        section_lineage: {
          kind: "section",
          title: "Document relationships",
          defaultOpen: true,
          childIds: ["lineage_1"],
        },
        lineage_1: {
          kind: "lineage_tree",
          rootDocumentId: DOC_1,
          rootPublishedVersionId: VER_1,
        },
      },
      bindings: {
        documents: [
          { documentId: DOC_1, publishedVersionId: VER_1 },
          { documentId: DOC_2, publishedVersionId: VER_2 },
        ],
        citationIndexes: [1, 2],
      },
    };

    const onAction = vi.fn();
    const onOpenCitation = vi.fn();
    const onPrefillPrompt = vi.fn();

    const { container } = render(
      <UiSurfaceRenderer
        surface={surface}
        hydratedDocuments={hydratedDocuments}
        turnHydration={turnHydration}
        citations={[citation1, citation2]}
        fallbackAnswer="Fallback text"
        onAction={onAction}
        onOpenCitation={onOpenCitation}
        onPrefillPrompt={onPrefillPrompt}
      />,
    );

    // Zero raw anchor tags anywhere in the rendered surface.
    expect(container.querySelectorAll("a[href]")).toHaveLength(0);

    // Metrics strip
    expect(screen.getByText("Matched documents")).toBeTruthy();
    expect(screen.getByText("Open cases")).toBeTruthy();

    // Prose rendered via CitedAnswer (strong tag, no raw ** markers)
    expect(screen.getByText("Access review").tagName).toBe("STRONG");
    expect(container.textContent).not.toContain("**");

    // Row columns attribute
    const rowEl = container.querySelector(".arden-surface-row");
    expect(rowEl?.getAttribute("data-columns")).toBe("2");

    // Document items + visual quarantine of highlightNote
    expect(screen.getByText("Primary Standard")).toBeTruthy();
    expect(screen.getAllByText("Access Control Standard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Uncategorized").length).toBeGreaterThan(0);
    const aiNote = container.querySelector("[data-ai-quarantine='true']");
    expect(aiNote).toBeTruthy();
    expect(aiNote?.textContent).toContain("Note");
    expect(aiNote?.textContent).toContain("Covers the five-day lead time requirement.");
    const docFacts = container.querySelector(".arden-surface-doc-facts");
    expect(docFacts?.contains(aiNote!)).toBe(false);

    // Callout with tone badge & citation chips
    expect(screen.getByText("Lead-time difference")).toBeTruthy();
    expect(screen.getByText("Conflict")).toBeTruthy();

    // Comparison table semantics + scroll frame + citation opener callback
    const tableRegion = screen.getByRole("region", { name: "Access policy comparison" });
    expect(tableRegion.tabIndex).toBe(0);
    const table = within(tableRegion).getByRole("table");
    expect(table.querySelector("caption")?.textContent).toBe("Access policy comparison");
    const colHeaders = table.querySelectorAll("th[scope='col']");
    expect(colHeaders).toHaveLength(2);
    const tableCitationBtn = within(table).getByRole("button", {
      name: "Source 2: Contractor Onboarding Guide",
    });
    fireEvent.click(tableCitationBtn);
    expect(onOpenCitation).toHaveBeenCalledWith(citation2, tableCitationBtn);

    // Depth-4 split + governance_kv inside active tab
    expect(screen.getByText("Standard Governance")).toBeTruthy();
    expect(screen.getByText("Guide Governance")).toBeTruthy();
    expect(screen.getByText("Linh Tran")).toBeTruthy();
    expect(screen.getByText("Security Baseline")).toBeTruthy();

    // Lineage tree edges
    expect(screen.getByText("Legacy Access Policy 1.0")).toBeTruthy();
    expect(screen.getByText("References")).toBeTruthy();
    expect(screen.getByText("Supersedes")).toBeTruthy();

    // All 4 allowlisted actions work cleanly
    const graphBtn = screen.getByRole("button", { name: "Inspect in Graph" });
    fireEvent.click(graphBtn);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "graph_action", label: "Inspect in Graph", action: { op: "focus_nodes", documentIds: [DOC_1] } },
      graphBtn,
      expect.arrayContaining([expect.objectContaining({ documentId: DOC_1, publishedVersionId: VER_1 })]),
    );

    const readerBtn = screen.getByRole("button", { name: "Open policy" });
    fireEvent.click(readerBtn);
    expect(onAction).toHaveBeenCalledWith(
      { kind: "open_reader", label: "Open policy", documentId: DOC_1, publishedVersionId: VER_1, page: 2 },
      readerBtn,
      expect.arrayContaining([expect.objectContaining({ documentId: DOC_1, publishedVersionId: VER_1 })]),
    );

    const handoffBtn = screen.getByRole("button", { name: "Report issue" });
    fireEvent.click(handoffBtn);
    expect(onAction).toHaveBeenCalledWith(
      {
        kind: "workflow_handoff",
        label: "Report issue",
        handoff: "report_issue",
        documentId: DOC_1,
        publishedVersionId: VER_1,
      },
      handoffBtn,
      expect.arrayContaining([expect.objectContaining({ documentId: DOC_1, publishedVersionId: VER_1 })]),
    );

    const promptBtn = screen.getByRole("button", { name: "Compare contractor rules" });
    fireEvent.click(promptBtn);
    expect(onPrefillPrompt).toHaveBeenCalledWith(
      "Compare contractor access rules against full-time employees.",
    );
  });

  it("omits openMaintenanceCaseCount in governance_kv when null and displays 0 when zero", () => {
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["gov_null", "gov_zero"] },
        gov_null: { kind: "governance_kv", documentId: DOC_1, publishedVersionId: VER_1 },
        gov_zero: { kind: "governance_kv", documentId: DOC_2, publishedVersionId: VER_2 },
      },
      bindings: {
        documents: [
          { documentId: DOC_1, publishedVersionId: VER_1 },
          { documentId: DOC_2, publishedVersionId: VER_2 },
        ],
        citationIndexes: [],
      },
    };

    const hydratedDocuments: Record<string, HydratedDocumentSummary> = {
      [VER_1]: makeHydratedDoc({
        openMaintenanceCaseCount: null,
        authorDisplayName: null,
        type: null,
      }),
      [VER_2]: makeHydratedDoc({
        documentId: DOC_2,
        publishedVersionId: VER_2,
        title: "Zero Case Doc",
        openMaintenanceCaseCount: 0,
      }),
    };

    const { container } = render(
      <UiSurfaceRenderer
        surface={surface}
        hydratedDocuments={hydratedDocuments}
        citations={[]}
      />,
    );

    const lists = container.querySelectorAll("dl.arden-surface-kv");
    expect(lists).toHaveLength(2);

    // First dl: openMaintenanceCaseCount MUST be omitted completely when null
    expect(lists[0]!.querySelector("[data-field='openMaintenanceCaseCount']")).toBeNull();
    expect(lists[0]!.textContent).not.toContain("Open maintenance cases");
    expect(lists[0]!.querySelector("[data-field='authorDisplayName'] dd")?.textContent).toBe("—");
    expect(lists[0]!.querySelector("[data-field='type'] dd")?.textContent).toBe("Uncategorized");

    // Second dl: openMaintenanceCaseCount === 0 MUST be rendered as "0"
    const zeroRow = lists[1]!.querySelector("[data-field='openMaintenanceCaseCount']");
    expect(zeroRow).toBeTruthy();
    expect(zeroRow?.querySelector("dd")?.textContent).toBe("0");
  });

  it("hides unauthorized workflow_handoff actions when capability flags are false", () => {
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "card_root",
      nodes: {
        card_root: {
          kind: "card",
          title: "Restricted Document",
          bodyIds: ["doc_1"],
          footerIds: ["act_report", "act_maint", "act_renew", "act_open"],
        },
        doc_1: { kind: "document_item", documentId: DOC_1, publishedVersionId: VER_1 },
        act_report: {
          kind: "workflow_handoff",
          label: "Report issue",
          handoff: "report_issue",
          documentId: DOC_1,
          publishedVersionId: VER_1,
        },
        act_maint: {
          kind: "workflow_handoff",
          label: "Open maintenance",
          handoff: "open_maintenance_case",
          documentId: DOC_1,
          publishedVersionId: VER_1,
        },
        act_renew: {
          kind: "workflow_handoff",
          label: "Renew publication",
          handoff: "open_renewal",
          documentId: DOC_1,
          publishedVersionId: VER_1,
        },
        act_open: {
          kind: "open_reader",
          label: "Open document",
          documentId: DOC_1,
          publishedVersionId: VER_1,
        },
      },
      bindings: {
        documents: [{ documentId: DOC_1, publishedVersionId: VER_1 }],
        citationIndexes: [],
      },
    };

    render(
      <UiSurfaceRenderer
        surface={surface}
        hydratedDocuments={{
          [VER_1]: makeHydratedDoc({
            canReportIssue: true,
            canOpenMaintenance: false,
            canRenew: false,
          }),
        }}
        citations={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "Report issue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open document" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open maintenance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renew publication" })).toBeNull();
  });

  it("supports WAI-ARIA keyboard navigation on tabs (ArrowRight, ArrowLeft, Home, End) and section aria-expanded toggle", () => {
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["tabs_1", "sec_1"] },
        tabs_1: {
          kind: "tabs",
          defaultTabId: "t1",
          tabs: [
            { id: "t1", label: "Overview", childIds: ["p1"] },
            { id: "t2", label: "Policy", childIds: ["p2"] },
            { id: "t3", label: "Audit", childIds: ["p3"] },
          ],
        },
        p1: { kind: "prose", markdown: "Overview body" },
        p2: { kind: "prose", markdown: "Policy body" },
        p3: { kind: "prose", markdown: "Audit body" },
        sec_1: {
          kind: "section",
          title: "Collapsible details",
          defaultOpen: false,
          childIds: ["p4"],
        },
        p4: { kind: "prose", markdown: "Hidden detail text" },
      },
      bindings: { documents: [], citationIndexes: [] },
    };

    render(<UiSurfaceRenderer surface={surface} citations={[]} />);

    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);
    expect(screen.getByText("Overview body")).toBeTruthy();
    expect(screen.queryByText("Policy body")).toBeNull();

    // ArrowRight moves to Policy
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(screen.getByText("Policy body")).toBeTruthy();

    // End moves to Audit
    fireEvent.keyDown(tabs[1]!, { key: "End" });
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);
    expect(screen.getByText("Audit body")).toBeTruthy();

    // ArrowRight wraps to Overview
    fireEvent.keyDown(tabs[2]!, { key: "ArrowRight" });
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0]);

    // ArrowLeft wraps to Audit
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);

    // Home returns to Overview
    fireEvent.keyDown(tabs[2]!, { key: "Home" });
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0]);

    // Section disclosure toggle
    const toggle = screen.getByRole("button", { name: "Collapsible details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Hidden detail text")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Hidden detail text")).toBeTruthy();
    const controlsId = toggle.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId!)?.textContent).toContain("Hidden detail text");
  });

  it("shows calm empty states for lineage_tree with zero edges and hides metric_strip when turnHydration is absent", () => {
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["m1", "l1"] },
        m1: { kind: "metric_strip", metricKeys: ["MATCHED_DOCS", "OPEN_MAINTENANCE_CASES"] },
        l1: { kind: "lineage_tree", rootDocumentId: DOC_1, rootPublishedVersionId: VER_1 },
      },
      bindings: {
        documents: [{ documentId: DOC_1, publishedVersionId: VER_1 }],
        citationIndexes: [],
      },
    };

    const { container } = render(
      <UiSurfaceRenderer
        surface={surface}
        hydratedDocuments={{ [VER_1]: makeHydratedDoc() }}
        turnHydration={{ metrics: {}, lineages: { l1: { rootDocumentId: DOC_1, edges: [] } } }}
        citations={[]}
      />,
    );

    expect(container.querySelector(".arden-surface-metrics")).toBeNull();
    expect(screen.getByText("No direct document relationships visible")).toBeTruthy();
  });

  it("renders all document validity statuses (Current, Expiring soon, Expired) with icon + text and all callout tones", () => {
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: {
          kind: "stack",
          childIds: ["d1", "d2", "d3", "c_info", "c_warn", "c_gap"],
        },
        d1: { kind: "document_item", documentId: DOC_1, publishedVersionId: VER_1 },
        d2: { kind: "document_item", documentId: DOC_2, publishedVersionId: VER_2 },
        d3: { kind: "document_item", documentId: DOC_3, publishedVersionId: VER_3 },
        c_info: { kind: "callout", tone: "info", title: "Info note", body: "Scope is company-wide.", citationIndexes: [1] },
        c_warn: { kind: "callout", tone: "warning", title: "Expiring policy", body: "Renewal due soon." },
        c_gap: { kind: "callout", tone: "gap", title: "Evidence gap", body: "No travel rates found." },
      },
      bindings: {
        documents: [
          { documentId: DOC_1, publishedVersionId: VER_1 },
          { documentId: DOC_2, publishedVersionId: VER_2 },
          { documentId: DOC_3, publishedVersionId: VER_3 },
        ],
        citationIndexes: [1],
      },
    };

    const { container } = render(
      <UiSurfaceRenderer
        surface={surface}
        hydratedDocuments={{
          [VER_1]: makeHydratedDoc({ validityStatus: "Current", daysUntilExpiry: null }),
          [VER_2]: makeHydratedDoc({
            documentId: DOC_2,
            publishedVersionId: VER_2,
            title: "Expiring Doc",
            validityStatus: "Expiring soon",
            daysUntilExpiry: 7,
          }),
          [VER_3]: makeHydratedDoc({
            documentId: DOC_3,
            publishedVersionId: VER_3,
            title: "Expired Doc",
            validityStatus: "Expired",
            daysUntilExpiry: 0,
          }),
        }}
        citations={[citation1]}
      />,
    );

    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Expiring soon")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(container.querySelectorAll(".arden-surface-badge svg")).toHaveLength(3);
    expect(screen.getByText("Info note")).toBeTruthy();
    expect(screen.getByText("Expiring policy")).toBeTruthy();
    expect(screen.getByText("Evidence gap")).toBeTruthy();
  });

  it("renders 3-column rows and graceful placeholders when hydrated documents are missing", () => {
    const surface: BoundUiSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", gap: "sm", childIds: ["row_3"] },
        row_3: { kind: "row", columns: 3, childIds: ["d1", "g1", "p1"] },
        d1: { kind: "document_item", documentId: DOC_1, publishedVersionId: VER_1 },
        g1: { kind: "governance_kv", documentId: DOC_1, publishedVersionId: VER_1 },
        p1: { kind: "prose", markdown: "Summary text" },
      },
      bindings: {
        documents: [{ documentId: DOC_1, publishedVersionId: VER_1 }],
        citationIndexes: [],
      },
    };

    const { container } = render(
      <UiSurfaceRenderer surface={surface} hydratedDocuments={{}} citations={[]} />,
    );

    expect(container.querySelector(".arden-surface-stack")?.getAttribute("data-gap")).toBe("sm");
    expect(container.querySelector(".arden-surface-row")?.getAttribute("data-columns")).toBe("3");
    expect(screen.getByText("Document details unavailable.")).toBeTruthy();
    expect(screen.getByText("Governance details unavailable.")).toBeTruthy();
  });
});

describe("UiSurfaceRenderer — XSS hardening and graceful fallback", () => {
  it.each([
    ["<script>alert(1)</script>"],
    ["<img src=x onerror=alert(1)>"],
    ["[click](javascript:alert(1))"],
  ])("neutralizes malicious payload %s via safe fallback with zero active DOM elements", (payload) => {
    const poisonedSurface = {
      schemaVersion: 1,
      rootId: "root",
      nodes: {
        root: { kind: "stack", childIds: ["p1"] },
        p1: { kind: "prose", markdown: payload },
      },
      bindings: { documents: [], citationIndexes: [] },
    } as unknown as BoundUiSurface;

    const { container } = render(
      <UiSurfaceRenderer
        surface={poisonedSurface}
        citations={[]}
        fallbackAnswer={`Safe fallback text: ${payload}`}
      />,
    );

    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("Safe fallback text:");
  });

  it("degrades gracefully to CitedAnswer when surface is malformed, cyclic, or missing root", () => {
    const brokenSurfaces: unknown[] = [
      null,
      { schemaVersion: 99, rootId: "root", nodes: {}, bindings: { documents: [], citationIndexes: [] } },
      {
        schemaVersion: 1,
        rootId: "missing",
        nodes: { root: { kind: "stack", childIds: ["p1"] }, p1: { kind: "prose", markdown: "Hi" } },
        bindings: { documents: [], citationIndexes: [] },
      },
      {
        schemaVersion: 1,
        rootId: "a",
        nodes: {
          a: { kind: "stack", childIds: ["b"] },
          b: { kind: "stack", childIds: ["a"] },
        },
        bindings: { documents: [], citationIndexes: [] },
      },
      {
        schemaVersion: 1,
        rootId: "toString",
        nodes: {},
        bindings: { documents: [], citationIndexes: [] },
      },
    ];

    for (const bad of brokenSurfaces) {
      const { container, unmount } = render(
        <UiSurfaceRenderer
          surface={bad as BoundUiSurface}
          citations={[citation1]}
          fallbackAnswer="**Graceful** fallback answer [1]."
          onOpenCitation={vi.fn()}
        />,
      );
      expect(container.querySelector(".arden-ui-surface")).toBeNull();
      expect(screen.getByText("Graceful").tagName).toBe("STRONG");
      expect(screen.getByRole("button", { name: "Source 1: Access Control Standard" })).toBeTruthy();
      unmount();
    }
  });
});

describe("Ask Arden chat UI integration (AskArdenPage + AgentPanel)", () => {
  const richSurface: BoundUiSurface = {
    schemaVersion: 1,
    rootId: "root",
    nodes: {
      root: { kind: "stack", childIds: ["p1", "card_1"] },
      p1: { kind: "prose", markdown: "Submit requests early [1].", citationIndexes: [1] },
      card_1: {
        kind: "card",
        title: "Referenced Policy",
        bodyIds: ["doc_1"],
        footerIds: ["chip_1", "open_1"],
      },
      doc_1: { kind: "document_item", documentId: DOC_1, publishedVersionId: VER_1 },
      chip_1: {
        kind: "prompt_chip",
        label: "Show escalation steps",
        prompt: "What are the escalation steps for urgent access?",
      },
      open_1: {
        kind: "open_reader",
        label: "Open in reader",
        documentId: DOC_1,
        publishedVersionId: VER_1,
        page: 2,
      },
    },
    bindings: {
      documents: [{ documentId: DOC_1, publishedVersionId: VER_1 }],
      citationIndexes: [1],
    },
  };

  it("renders uiSurface in AskArdenPage, prefills and focuses composer on prompt_chip WITHOUT auto-submitting, and preserves legacy uiSurface: null turns", async () => {
    const askSpy = vi.spyOn(api, "askArden")
      .mockResolvedValueOnce({
        status: "ANSWERED",
        conversationId: "conv-ui-1",
        turnId: "turn-1",
        revision: 1,
        answer: "Submit requests early [1].",
        citations: [citation1],
        uiSurface: richSurface,
        turnHydration: { metrics: {}, lineages: {} },
        hydratedDocuments: { [VER_1]: makeHydratedDoc() },
      })
      .mockResolvedValueOnce({
        status: "ANSWERED",
        conversationId: "conv-ui-1",
        turnId: "turn-2",
        revision: 2,
        answer: "Legacy plain answer without surface.",
        citations: [],
        uiSurface: null,
      });

    const onOpenCitation = vi.fn();
    render(<AskArdenPage platform="web" organizationId="org-1" onOpenCitation={onOpenCitation} />);

    const initialInput = screen.getByRole("textbox", { name: "Ask Arden" });
    fireEvent.change(initialInput, { target: { value: "How early do I request access?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Referenced Policy")).toBeTruthy();
    expect(askSpy).toHaveBeenCalledTimes(1);

    // Click prompt_chip: prefills + focuses composer ONLY — never auto-submits!
    const chip = screen.getByRole("button", { name: "Show escalation steps" });
    fireEvent.click(chip);
    const dockedInput = screen.getByRole("textbox", { name: "Ask Arden" }) as HTMLTextAreaElement;
    expect(dockedInput.value).toBe("What are the escalation steps for urgent access?");
    await waitFor(() => expect(document.activeElement).toBe(dockedInput));
    expect(askSpy).toHaveBeenCalledTimes(1);

    // Default open_reader action falls back to onOpenCitation when onSurfaceAction is omitted.
    fireEvent.click(screen.getByRole("button", { name: "Open in reader" }));
    expect(onOpenCitation).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: DOC_1, versionId: VER_1, page: 2 }),
    );

    // Second turn with legacy uiSurface: null still renders via CitedAnswer
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Legacy plain answer without surface.")).toBeTruthy();
    expect(askSpy).toHaveBeenCalledTimes(2);
  });

  it("prefills and focuses composer on prompt_chip inside AgentPanel without auto-submitting and forwards onSurfaceAction", async () => {
    const askSpy = vi.spyOn(api, "askArden").mockResolvedValue({
      status: "ANSWERED",
      conversationId: "conv-panel-1",
      turnId: "turn-p1",
      revision: 1,
      answer: "Submit requests early [1].",
      citations: [citation1],
      uiSurface: richSurface,
      turnHydration: { metrics: {}, lineages: {} },
      hydratedDocuments: { [VER_1]: makeHydratedDoc() },
    });
    const onSurfaceAction = vi.fn();

    render(
      <AgentPanel
        open
        platform="web"
        organizationId="org-1"
        source={{ kind: "company" }}
        onClose={vi.fn()}
        onOpenAskArden={vi.fn()}
        onSurfaceAction={onSurfaceAction}
      />,
    );

    const panel = screen.getByRole("complementary", { name: "Ask Arden" });
    const input = within(panel).getByRole("textbox", { name: "Ask Arden" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Check policy" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Send message" }));

    expect(await within(panel).findByText("Referenced Policy")).toBeTruthy();
    expect(askSpy).toHaveBeenCalledTimes(1);

    // Clicking prompt_chip prefills + focuses composer without submitting
    fireEvent.click(within(panel).getByRole("button", { name: "Show escalation steps" }));
    expect(input.value).toBe("What are the escalation steps for urgent access?");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(askSpy).toHaveBeenCalledTimes(1);

    // Clicking open_reader forwards to custom onSurfaceAction seam
    const openBtn = within(panel).getByRole("button", { name: "Open in reader" });
    fireEvent.click(openBtn);
    expect(onSurfaceAction).toHaveBeenCalledWith(
      {
        kind: "open_reader",
        label: "Open in reader",
        documentId: DOC_1,
        publishedVersionId: VER_1,
        page: 2,
      } satisfies SurfaceAction,
      openBtn,
      [expect.objectContaining({ documentId: DOC_1, publishedVersionId: VER_1 })],
    );
  });

  it("loads hydrated surfaces from saved conversations via loadAiConversation", async () => {
    vi.spyOn(api, "listAiConversations").mockResolvedValue([
      { id: "saved-1", title: "Saved UI Surface Chat", revision: 1, updatedAt: "2026-11-26T10:00:00Z" },
    ]);
    vi.spyOn(api, "loadAiConversation").mockResolvedValue({
      id: "saved-1",
      title: "Saved UI Surface Chat",
      revision: 1,
      updatedAt: "2026-11-26T10:00:00Z",
      hydratedDocuments: { [VER_1]: makeHydratedDoc() },
      turns: [
        {
          id: "saved-turn-1",
          requestId: "req-1",
          question: "Show standard",
          sequence: 1,
          answer: "Submit requests early [1].",
          status: "ANSWERED",
          citations: [citation1],
          uiSurface: richSurface,
          turnHydration: { metrics: {}, lineages: {} },
        },
      ],
    });

    render(<AskArdenPage platform="web" organizationId="org-1" />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Saved UI Surface Chat/ }));
    expect(await screen.findByText("Referenced Policy")).toBeTruthy();
    expect(screen.getByText("Information Security")).toBeTruthy();

    // Citation chip inside surface prose opens Sources panel and restores focus on Escape.
    const chip = screen.getByRole("button", { name: "Source 1: Access Control Standard" });
    chip.focus();
    fireEvent.click(chip);
    const panel = screen.getByRole("complementary", { name: "Sources" });
    const passage = within(panel).getByRole("article", { name: "Passage on page 2" });
    expect(document.activeElement).toBe(passage);
    fireEvent.keyDown(passage, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Sources" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(chip));
  });

  it("loads earlier turns in the shared transcript using the oldest visible sequence", async () => {
    const saved = { id: "saved-1", title: "Saved chat", revision: 22, updatedAt: "2026-11-26T10:00:00Z" };
    const response = vi.fn(async (uri: string) => {
      const { pathname, searchParams } = new URL(uri);
      if (pathname.endsWith("/conversations")) return Response.json({ items: [saved] });
      if (!searchParams.has("beforeSequence")) {
        return Response.json({ ...saved, hasMore: true, turns: [{
          id: "turn-22", requestId: "req-22", sequence: 22, question: "Latest question",
          status: "ANSWERED", answer: "Latest answer", citations: [],
        }] });
      }
      expect(searchParams.get("beforeSequence")).toBe("22");
      return Response.json({ ...saved, hasMore: false, hydratedDocuments: { [VER_1]: makeHydratedDoc() }, turns: [
        { id: "turn-20", requestId: "req-20", sequence: 20, question: "Earlier question",
          status: "ANSWERED", answer: "Submit requests early [1].", citations: [citation1], uiSurface: richSurface },
        { id: "turn-21", requestId: "req-21", sequence: 21, question: "Withdrawn sources",
          status: "UNAVAILABLE", answer: "This answer is no longer available.", citations: [] },
      ] });
    });
    vi.stubGlobal("fetch", response);
    function SharedChat() {
      const chat = useArdenChat({ platform: "web", organizationId: "org-1", source: { kind: "company" } });
      return <>
        <AskArdenPage platform="web" organizationId="org-1" chat={chat} />
        <AgentPanel open platform="web" organizationId="org-1" source={{ kind: "company" }} companyChat={chat}
          onClose={vi.fn()} onOpenAskArden={vi.fn()} />
      </>;
    }
    try {
      render(<SharedChat />);
      fireEvent.click(screen.getByRole("button", { name: "History" }));
      fireEvent.click(await screen.findByRole("button", { name: /Saved chat/ }));
      const panel = within(screen.getByRole("complementary", { name: "Ask Arden" }));
      fireEvent.click(await panel.findByRole("button", { name: "Load earlier messages" }));
      expect(await panel.findByText("Referenced Policy")).toBeTruthy();
      const transcripts = screen.getAllByRole("region", { name: "Conversation" });
      expect(transcripts).toHaveLength(2);
      for (const transcript of transcripts) {
        const view = within(transcript);
        const prompts = view.getAllByRole("article").filter((entry) => entry.classList.contains("is-member"));
        expect(prompts.map((entry) => entry.querySelector("p")?.textContent))
          .toEqual(["Earlier question", "Withdrawn sources", "Latest question"]);
        expect(view.getByText("This answer is no longer available.")).toBeTruthy();
        expect(view.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
      }
      expect(response).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("discards an earlier page if the reader opens another conversation while it is loading", async () => {
    const makePage = (id: string, sequence: number): api.AiConversation => ({
      id, title: id, revision: sequence, updatedAt: "2026-11-26T10:00:00Z", hasMore: sequence > 1,
      turns: [{ id: `${id}-${sequence}`, requestId: "req", sequence, question: id,
        status: "ANSWERED", answer: "Saved answer", citations: [] }],
    });
    let resolveEarlier!: (page: api.AiConversation) => void;
    vi.spyOn(api, "loadAiConversation").mockResolvedValueOnce(makePage("first", 21))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveEarlier = resolve; }))
      .mockResolvedValueOnce(makePage("second", 1));
    const { result } = renderHook(() => useArdenChat({ platform: "web", organizationId: "org-1", source: { kind: "company" } }));
    await act(() => result.current.openConversation("first"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadEarlier(); });
    await act(() => result.current.openConversation("second"));
    await act(async () => { resolveEarlier(makePage("first", 1)); await pending; });
    expect(result.current.messages.map((message) => message.id)).toEqual(["second-1-question", "second-1"]);
    expect(result.current.earlier).toBeNull();
  });
});

describe("UiSurface CSS @container & zero-ResizeObserver/innerHTML architecture invariants", () => {
  it("defines pure CSS @container breakpoints and accessibility media queries in ui-surface.css", async () => {
    const rootStylesCss = await readLocalText("../../styles.css");
    const uiSurfaceCss = await readLocalText("../../styles/ui-surface.css");
    expect(rootStylesCss).toContain('./styles/ui-surface.css');
    expect(uiSurfaceCss).toContain("container-type: inline-size");
    expect(uiSurfaceCss).toContain("container-name: arden-surface");
    expect(uiSurfaceCss).toContain("@container arden-surface (max-width: 439px)");
    expect(uiSurfaceCss).toContain("@container arden-surface (min-width: 440px) and (max-width: 559px)");
    expect(uiSurfaceCss).toContain("@media (hover: hover) and (pointer: fine)");
    expect(uiSurfaceCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(uiSurfaceCss).toContain("@media (prefers-contrast: more)");
    expect(uiSurfaceCss).toContain("tabular-nums");
  });

  it("uses zero ResizeObserver, zero innerHTML, and zero dangerouslySetInnerHTML across surface modules", async () => {
    const sources = await Promise.all([
      readLocalText("./UiSurfaceRenderer.tsx"),
      readLocalText("./containers.tsx"),
      readLocalText("./leaves.tsx"),
      readLocalText("./ActionBar.tsx"),
      readLocalText("./formatters.ts"),
    ]);
    const allSources = sources.join("\n");
    expect(allSources).not.toMatch(/ResizeObserver/);
    expect(allSources).not.toMatch(/dangerouslySetInnerHTML/);
    expect(allSources).not.toMatch(/\.innerHTML\b/);
  });
});
