import { accessRules } from "./previewModel";

export function AccessRules() {
  return (
    <div className="organization-editor-stack">
      <div className="organization-section-heading">
        <div>
          <span className="meta-label">DOCUMENT VISIBILITY</span>
          <h2>Initial access rules</h2>

        </div>
      </div>
      <div className="access-rule-grid">
        {accessRules.map((rule, index) => (
          <section className="access-rule-card" key={rule.scope}>
            <span className="access-rule-number">0{index + 1}</span>
            <h3>{rule.scope}</h3>
            <strong>{rule.audience}</strong>
            <p>{rule.detail}</p>
          </section>
        ))}
      </div>

    </div>
  );
}
