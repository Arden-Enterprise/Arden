import { KnowledgeConnections } from "./KnowledgeConnections";
import { entryAssets } from "./entryAssets";

export function WelcomePanel({ mode = "sign-in" }: { mode?: "sign-in" | "workspace" }) {
  const selectingWorkspace = mode === "workspace";
  return (
    <section className="sign-in-intro" aria-labelledby="welcome-title">
      <div className="sign-in-brand">
        <img src={entryAssets.brand} alt="" width={28} height={28} />
        <span>ARDEN</span>
      </div>
      <div className="sign-in-welcome-copy">
        <span className="welcome-status">
          <img src={entryAssets.statusJade} alt="" width={7} height={7} />
          {selectingWorkspace ? "WELCOME BACK, LAN NGUYEN" : "PRIVATE ORGANIZATIONAL MEMORY"}
        </span>
        <h1 id="welcome-title">
          {selectingWorkspace ? <>Your work. <br />Your context.</> : <>A place for your <br />next good thought.</>}
        </h1>
        <p>
          {selectingWorkspace
            ? "Choose the organization you want to work with. Your personal notes stay yours in every workspace."
            : "Keep rough ideas private. Connect the knowledge you can access. Turn the right thoughts into shared understanding."}
        </p>
        <KnowledgeConnections />
      </div>
      <div className="sign-in-boundary">
        <img src={entryAssets.lockBoundary} alt="" width={20} height={20} />
        <div>
          <strong>{selectingWorkspace ? "Your boundaries travel with you" : "Private by default"}</strong>
          <span>Only authorized knowledge. No external writes without your permission.</span>
        </div>
      </div>
    </section>
  );
}
