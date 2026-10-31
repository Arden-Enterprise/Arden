import { type ReactNode } from "react";
import { ArdenGlyphOrb } from "./ArdenGlyphOrb";

export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="auth-entry-page">
      <div className="auth-ambient" aria-hidden="true">
        <ArdenGlyphOrb />
      </div>
      <div className="auth-entry-content">
        <div className={`auth-entry-panel ${wide ? "is-wide" : ""}`}>
          {children}
        </div>
      </div>
    </main>
  );
}
