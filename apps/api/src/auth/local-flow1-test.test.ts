import { describe, expect, it } from "vitest";
import {
  assertLocalFlow1TestTarget,
  LocalFlow1TestAuthProvider,
  parseLocalTestAccounts,
} from "./local-flow1-test.js";
import { isKietLocalFlow1TestTarget, kietLocalFlow1TestActor } from "./remote-flow1-test.js";

const accountsJson = JSON.stringify([
  { userId: "11111111-1111-4111-8111-111111111111", email: "admin@example.test", fullName: "Local Admin", password: "local-test-password-01" },
  { userId: "22222222-2222-4222-8222-222222222222", email: "member@example.test", fullName: "Local Member", password: "local-test-password-02" },
]);

describe("isolated local Mainflow 1 test auth", () => {
  it("accepts only the explicit loopback disposable database and local API bind", () => {
    expect(() => assertLocalFlow1TestTarget(
      "postgresql://arden_api:secret@127.0.0.1:5433/arden_test_flow1", "127.0.0.1", "development", false,
    )).not.toThrow();
  });

  it.each([
    ["Coolify database", "postgresql://arden_api:secret@postgres.example.test:5432/arden_dev_2", "127.0.0.1", "development", false],
    ["local development database", "postgresql://arden:secret@localhost:5433/arden", "127.0.0.1", "development", false],
    ["production mode", "postgresql://arden_api:secret@localhost:5433/arden_test_flow1", "127.0.0.1", "production", false],
    ["network API bind", "postgresql://arden_api:secret@localhost:5433/arden_test_flow1", "0.0.0.0", "development", false],
    ["configured Supabase", "postgresql://arden_api:secret@localhost:5433/arden_test_flow1", "127.0.0.1", "development", true],
  ])("rejects %s", (_label, databaseUrl, apiHost, nodeEnvironment, supabaseConfigured) => {
    expect(() => assertLocalFlow1TestTarget(
      String(databaseUrl), String(apiHost), String(nodeEnvironment), Boolean(supabaseConfigured),
    )).toThrow();
  });

  it("accepts only bounded synthetic example.test accounts with strong local passwords", () => {
    const accounts = parseLocalTestAccounts(accountsJson);
    expect(accounts.map(({ email }) => email)).toEqual(["admin@example.test", "member@example.test"]);
    expect(() => parseLocalTestAccounts(JSON.stringify([
      { userId: "11111111-1111-4111-8111-111111111111", email: "real.person@example.com", fullName: "Test", password: "local-test-password-01" },
    ]))).toThrow(/example\.test/);
    expect(() => parseLocalTestAccounts(JSON.stringify([
      { userId: "11111111-1111-4111-8111-111111111111", email: "admin@example.test", fullName: "Test", password: "short" },
    ]))).toThrow(/16-character/);
  });

  it("issues revocable in-memory sessions only for configured test accounts", async () => {
    const auth = new LocalFlow1TestAuthProvider(parseLocalTestAccounts(accountsJson));
    await expect(auth.signIn({ email: "unknown@example.test", password: "local-test-password-01" })).rejects.toThrow("INVALID_CREDENTIALS");
    const signedIn = await auth.signIn({ email: "ADMIN@example.test", password: "local-test-password-01" });
    const resolved = await auth.resolveSession(signedIn.tokens);
    expect(resolved).toMatchObject({ kind: "authenticated", userId: "11111111-1111-4111-8111-111111111111", email: "admin@example.test", emailVerified: true });
    await auth.signOut(signedIn.tokens);
    expect(await auth.resolveSession(signedIn.tokens)).toEqual({ kind: "unauthenticated" });
    await expect(auth.signUp({ email: "new@example.test", password: "local-test-password-03", fullName: "New" })).rejects.toThrow("SIGNUP_REJECTED");
  });
});

describe("Kiet Local no-login test mode", () => {
  const databaseUrl = "postgresql://arden_api:secret@postgres:5432/arden_dev_2";

  it("recognizes only the dedicated Kiet Local development database without Supabase", () => {
    expect(isKietLocalFlow1TestTarget(databaseUrl, "development", false)).toBe(true);
    expect(kietLocalFlow1TestActor).toMatchObject({ email: "kiet-local@example.test", emailVerified: true });
  });

  it.each([
    ["production", databaseUrl, "production", false],
    ["non-development runtime", databaseUrl, "test", false],
    ["wrong database name", "postgresql://arden_api:secret@postgres:5432/arden", "development", false],
    ["wrong database host", "postgresql://arden_api:secret@db:5432/arden_dev_2", "development", false],
    ["Supabase enabled", databaseUrl, "development", true],
  ])("does not enable the mock actor for %s", (_label, target, environment, supabaseConfigured) => {
    expect(isKietLocalFlow1TestTarget(
      String(target), String(environment), Boolean(supabaseConfigured),
    )).toBe(false);
  });
});
