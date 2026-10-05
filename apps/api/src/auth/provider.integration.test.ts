import { describe, expect, it } from "vitest";
import { SupabaseAuthProvider } from "./provider.js";

const url = process.env.ARDEN_TEST_SUPABASE_URL;
const publishableKey = process.env.ARDEN_TEST_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.ARDEN_TEST_SUPABASE_EMAIL;
const password = process.env.ARDEN_TEST_SUPABASE_PASSWORD;
const configured = Boolean(url && publishableKey && email && password);

describe.skipIf(!configured)("live Supabase Auth session smoke test", () => {
  it("authenticates the synthetic user and rejects the session after sign-out", async () => {
    if (!url || !publishableKey || !email || !password) throw new Error("Live Supabase test configuration is missing");
    const auth = new SupabaseAuthProvider(url, publishableKey);
    const session = await auth.signIn({ email, password });
    expect(session.userId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(auth.resolveSession(session.tokens)).resolves.toMatchObject({ kind: "authenticated", userId: session.userId });

    await auth.signOut(session.tokens);
    await expect(auth.resolveSession(session.tokens)).resolves.toMatchObject({ kind: "unauthenticated" });
  });
});
