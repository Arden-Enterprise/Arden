import { useEffect, useState } from "react";
import { ApiError, loadPrivateFeedbackAnalytics, type PrivateFeedbackWeek } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { AuthLayout } from "./AuthLayout";

export function SystemFeedbackPage({ platform, onBack }: { platform: Platform; onBack: () => void }) {
  const [weeks, setWeeks] = useState<PrivateFeedbackWeek[] | null>(null);
  const [error, setError] = useState<"denied" | "load" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void loadPrivateFeedbackAnalytics(platform).then(result => {
      if (active) setWeeks(result.weeks);
    }).catch(error => {
      if (active) setError(error instanceof ApiError && [401, 403, 404].includes(error.status) ? "denied" : "load");
    });
    return () => { active = false; };
  }, [platform, attempt]);

  return <AuthLayout wide>
    <section className="auth-card auth-workspace-card" aria-labelledby="system-feedback-title">
      <div className="auth-card-main">
        <span className="auth-eyebrow">SYSTEM ADMIN</span>
        <h1 id="system-feedback-title">Private AI feedback</h1>
        <p className="auth-helper-text system-feedback-description">Latest ratings by week, starting Monday (UTC).</p>
        {error ? <div className="auth-message" role="alert">
          {error === "denied" ? "System Admin access is required." : "Feedback analytics could not be loaded."}
        </div> : weeks === null ? <p className="auth-helper-text" role="status">Loading feedback…</p>
          : !weeks.some(week => week.good + week.bad > 0) ? <p className="auth-helper-text" role="status">No ratings in the last 12 weeks.</p>
            : <div className="system-feedback-data">
              <table className="system-feedback-table" aria-label="Weekly Private AI feedback">
                <thead><tr><th scope="col">Week of</th><th scope="col">Good</th><th scope="col">Bad</th>
                  <th scope="col">Total</th><th scope="col">Good rate</th></tr></thead>
                <tbody>{weeks.map(({ weekStart, good, bad }) => {
                  const total = good + bad;
                  return <tr key={weekStart}><th scope="row">{weekStart}</th><td>{good}</td><td>{bad}</td>
                    <td>{total}</td><td>{total ? `${Math.round(good / total * 100)}%` : "—"}</td></tr>;
                })}</tbody>
              </table>
            </div>}
        <div className="auth-footer-links system-feedback-actions">
          <button type="button" className="auth-text-link" onClick={onBack}>Back to workspaces</button>
          {error === "load" && <button type="button" className="auth-text-link" onClick={() => {
            setWeeks(null); setError(null); setAttempt(current => current + 1);
          }}>Try again</button>}
        </div>
      </div>
    </section>
  </AuthLayout>;
}
