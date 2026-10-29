import type { AskArdenAnswer } from "../shared/api-client";

export type AskArdenMessage = {
  id: string;
  role: "member" | "assistant";
  body: string;
  citations?: AskArdenAnswer["citations"];
  insufficientEvidence?: boolean;
};

export const starterPrompts = [
  "How does knowledge approval work?",
  "Summarize our published onboarding guidance",
  "Which policy covers external sharing?",
] as const;

export function answerMessage(answer: AskArdenAnswer, id: string): AskArdenMessage {
  return {
    id,
    role: "assistant",
    body: answer.answer,
    citations: answer.citations.length ? answer.citations : undefined,
    insufficientEvidence: answer.status === "INSUFFICIENT_EVIDENCE",
  };
}
