import { type ReactNode } from "react";
import { ArdenGlyphOrb } from "./ArdenGlyphOrb";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-entry-page">
      <div className="auth-ambient" aria-hidden="true">
        <ArdenGlyphOrb />
      </div>
      <div className="auth-entry-content">
        <div className="auth-entry-panel">
          {children}
        </div>
      </div>
    </main>
  );
}
