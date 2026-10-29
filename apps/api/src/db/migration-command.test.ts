import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type MigrationCommandModule = {
  assertMigrationTarget: (mode: string, databaseUrl: string, nodeEnvironment?: string) => void;
  parseMigrationMode: (arguments_: string[]) => "plan" | "apply-safe" | "local-full";
};

const moduleUrl = new URL("./migrate.ts", import.meta.url);
const moduleExists = existsSync(fileURLToPath(moduleUrl));
let command: MigrationCommandModule | undefined;
if (moduleExists) command = await import(/* @vite-ignore */ moduleUrl.href) as MigrationCommandModule;

describe("migration command safety", () => {
  it("implements explicit guarded command modes", () => {
    expect(moduleExists).toBe(true);
    expect(command?.assertMigrationTarget).toBeTypeOf("function");
    expect(command?.parseMigrationMode).toBeTypeOf("function");
  });

  it("accepts only a local development database for the full migration chain", () => {
    expect(() => command?.assertMigrationTarget("local-full", "postgresql://arden:dev@127.0.0.1:5433/arden", "development")).not.toThrow();
    expect(() => command?.assertMigrationTarget("local-full", "postgresql://postgres:dev@localhost:5432/arden_test_ci", "test")).not.toThrow();
    for (const [url, environment] of [
      ["postgresql://db.internal/arden", "development"],
      ["postgresql://localhost/customer_data", "development"],
      ["postgresql://localhost/arden", "production"],
    ]) {
      expect(() => command?.assertMigrationTarget("local-full", url, environment)).toThrow();
    }
  });

  it("requires exact explicit modes without accepting extra arguments", () => {
    expect(command?.parseMigrationMode(["--plan"])).toBe("plan");
    expect(command?.parseMigrationMode(["--apply-safe"])).toBe("apply-safe");
    expect(command?.parseMigrationMode(["--local-full"])).toBe("local-full");
    for (const args of [[], ["--apply-safe", "--local-full"], ["--shell", "anything"]]) {
      expect(() => command?.parseMigrationMode(args)).toThrow();
    }
  });
});
