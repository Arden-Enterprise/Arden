import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";

export type AskArdenCitation = KnowledgeCitationReference & {
  title: string;
  version: string;
  scope: string;
};

export type AskArdenMessage = {
  id: string;
  role: "member" | "assistant";
  body: string;
  citations?: AskArdenCitation[];
};

export const starterPrompts = [
  "How does knowledge approval work?",
  "Summarize our published onboarding guidance",
  "Which policy covers external sharing?",
] as const;

export const sampleConversation: AskArdenMessage[] = [
  {
    id: "sample-question",
    role: "member",
    body: starterPrompts[0],
  },
  {
    id: "sample-answer",
    role: "assistant",
    body: "A contributor submits an immutable snapshot of their working draft. A reviewer with an explicit grant can approve or reject that exact version. Approval moves it into preparation; it becomes searchable by Ask Arden only after indexing succeeds and the release is activated.",
    citations: [
      {
        documentId: "knowledge-publication-workflow",
        versionId: "publication-workflow-v2-1",
        blockId: "activation-boundary",
        excerpt: "Approval prepares the reviewed snapshot. Search and Ask Arden can use it only after indexing succeeds and the release is activated.",
        title: "Knowledge publication workflow",
        version: "v2.1",
        scope: "Company-wide",
      },
      {
        documentId: "reviewer-responsibility-guide",
        versionId: "reviewer-guide-v1-4",
        blockId: "reviewer-decision-boundary",
        excerpt: "A reviewer may approve or reject only the exact submitted snapshot covered by an active reviewer grant.",
        title: "Reviewer responsibility guide",
        version: "v1.4",
        scope: "Product Engineering",
      },
    ],
  },
];

export function disconnectedPreviewMessages(prompt: string): AskArdenMessage[] {
  const body = prompt.trim();
  if (!body) return [];
  return [
    { id: "preview-question", role: "member", body },
    {
      id: "preview-boundary",
      role: "assistant",
      body: "Ask Arden is not connected to retrieval yet. This prompt stays in this local interface preview and no knowledge was searched.",
    },
  ];
}

export function previewMessagesForPrompt(prompt: string): AskArdenMessage[] {
  const body = prompt.trim();
  return body === starterPrompts[0] ? sampleConversation : disconnectedPreviewMessages(body);
}
