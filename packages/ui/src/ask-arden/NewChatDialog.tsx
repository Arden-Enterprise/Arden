import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";

export function NewChatDialog({ hasDraft, onCancel, onConfirm }: { hasDraft: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <KnowledgeDialog confirmation title="Start a new chat?" onClose={onCancel}>
    <p>{hasDraft ? "Your unsent message will be discarded. Saved chats stay in History." : "Saved chats stay in History."}</p>
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      <button type="button" className="primary-button" onClick={onConfirm}>New chat</button></div>
  </KnowledgeDialog>;
}
