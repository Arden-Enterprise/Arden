import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PasswordWorkLimiter } from "../system-auth/password.js";
import type { SystemActor, SystemActorResolver } from "../system-auth/routes.js";
import { registerSystemAdministrationRoutes } from "./routes.js";
import {
  SystemAdministrationError,
  type NewSystemAdministrator, type SystemAdministrationActor, type SystemAdministrationStore, type SystemAdministrator,
} from "./store.js";

const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const firstManagerId = "11111111-1111-4111-8111-111111111111";

/** Mirrors the database rules: manager recheck, monitor default, last admin/manager protection. */
class MemoryAdministrationStore implements SystemAdministrationStore {
  readonly administrators: SystemAdministrator[] = [{ id: firstManagerId, email: "first@arden.local", fullName: "First",
    status: "ACTIVE", canManageSystemAdmins: true, grantedByAdminId: null, grantedAt: new Date(0),
    revokedByAdminId: null, revokedAt: null }];
  readonly events: string[] = [];

  private requireManager(actor: SystemAdministrationActor) {
    if (!this.administrators.some((item) => item.id === actor.adminId && item.status === "ACTIVE" && item.canManageSystemAdmins)) {
      throw new SystemAdministrationError("SYSTEM_ADMINISTRATION_UNAVAILABLE");
    }
  }

  private active(id: string) {
    const found = this.administrators.find((item) => item.id === id && item.status === "ACTIVE");
    if (!found) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
    return found;
  }

  async overview(actor: SystemAdministrationActor) {
    this.requireManager(actor);
    return { administrators: this.administrators, recentEvents: [] };
  }

  async grant(actor: SystemAdministrationActor, target: NewSystemAdministrator) {
    this.requireManager(actor);
    if (this.administrators.some((item) => item.email === target.email && item.status === "ACTIVE")) {
      throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
    }
    const created: SystemAdministrator = { id: randomUUID(), email: target.email, fullName: target.fullName,
      status: "ACTIVE", canManageSystemAdmins: false, grantedByAdminId: actor.adminId, grantedAt: new Date(),
      revokedByAdminId: null, revokedAt: null };
    this.administrators.push(created);
    this.events.push("SYSTEM_ADMINISTRATOR_GRANTED");
    return created;
  }

  async revoke(actor: SystemAdministrationActor, targetAdminId: string) {
    this.requireManager(actor);
    const target = this.active(targetAdminId);
    const active = this.administrators.filter((item) => item.status === "ACTIVE");
    if (target.canManageSystemAdmins && active.filter((item) => item.canManageSystemAdmins).length === 1) {
      throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_LAST_MANAGER");
    }
    if (active.length === 1) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_LAST_ACTIVE");
    Object.assign(target, { status: "REVOKED", canManageSystemAdmins: false, revokedByAdminId: actor.adminId, revokedAt: new Date() });
    return target;
  }

  async setManagerCapability(actor: SystemAdministrationActor, targetAdminId: string, enabled: boolean) {
    this.requireManager(actor);
    const target = this.active(targetAdminId);
    if (!enabled && target.canManageSystemAdmins
      && this.administrators.filter((item) => item.status === "ACTIVE" && item.canManageSystemAdmins).length === 1) {
      throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_LAST_MANAGER");
    }
    target.canManageSystemAdmins = enabled;
    return target;
  }
}

describe("Isolated System Admin lifecycle routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function appFor(actorFor: (store: MemoryAdministrationStore) => SystemActor | null) {
    const store = new MemoryAdministrationStore();
    const resolve: SystemActorResolver = async (_request, reply) => {
      const actor = actorFor(store);
      if (!actor) {
        reply.header("Cache-Control", "no-store");
        reply.code(404).send({ error: { code: "SYSTEM_CONSOLE_UNAVAILABLE", message: "The resource is not available." } });
      }
      return actor;
    };
    const app = Fastify();
    registerSystemAdministrationRoutes(app, store, resolve, uuid, new PasswordWorkLimiter());
    apps.push(app);
    return { app, store };
  }

  const sessionOf = (store: MemoryAdministrationStore, adminId: string): SystemActor => {
    const admin = store.administrators.find((item) => item.id === adminId && item.status === "ACTIVE");
    return { adminId, sessionId: randomUUID(), canManageSystemAdmins: Boolean(admin?.canManageSystemAdmins) };
  };

  it("lets the first isolated manager grant a monitoring-only administrator and change its capability", async () => {
    const { app, store } = appFor((current) => sessionOf(current, firstManagerId));
    const listed = await app.inject("/api/v1/system/administrators");
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().administrators).toMatchObject([{ id: firstManagerId, canManageSystemAdmins: true }]);

    const granted = await app.inject({ method: "POST", url: "/api/v1/system/administrators",
      payload: { email: " Monitor@Arden.Local ", fullName: "Monitor", password: "StrongPassword!2" } });
    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({ email: "monitor@arden.local", status: "ACTIVE", canManageSystemAdmins: false });
    expect(granted.body).not.toContain("password");
    const monitorId = granted.json().id as string;

    const promoted = await app.inject({ method: "PATCH", url: `/api/v1/system/administrators/${monitorId}`,
      payload: { canManageSystemAdmins: true } });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().canManageSystemAdmins).toBe(true);

    const demotedSelf = await app.inject({ method: "PATCH", url: `/api/v1/system/administrators/${firstManagerId}`,
      payload: { canManageSystemAdmins: false } });
    expect(demotedSelf.statusCode).toBe(200);
    expect(store.administrators.find((item) => item.id === firstManagerId)?.canManageSystemAdmins).toBe(false);
  });

  it("protects the last manager and the last active administrator", async () => {
    const { app } = appFor((current) => sessionOf(current, firstManagerId));
    const demote = await app.inject({ method: "PATCH", url: `/api/v1/system/administrators/${firstManagerId}`,
      payload: { canManageSystemAdmins: false } });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe("SYSTEM_ADMINISTRATOR_LAST_MANAGER");
    const revoke = await app.inject({ method: "POST", url: `/api/v1/system/administrators/${firstManagerId}/revoke`, payload: {} });
    expect(revoke.statusCode).toBe(409);
  });

  it("hides the management API from monitoring-only administrators and signed-out callers", async () => {
    const monitorId = "22222222-2222-4222-8222-222222222222";
    const { app: monitorApp, store } = appFor(() => ({ adminId: monitorId, sessionId: randomUUID(), canManageSystemAdmins: false }));
    store.administrators.push({ id: monitorId, email: "monitor@arden.local", fullName: "Monitor", status: "ACTIVE",
      canManageSystemAdmins: false, grantedByAdminId: firstManagerId, grantedAt: new Date(), revokedByAdminId: null, revokedAt: null });
    expect((await monitorApp.inject("/api/v1/system/administrators")).statusCode).toBe(404);
    const selfPromotion = await monitorApp.inject({ method: "PATCH", url: `/api/v1/system/administrators/${monitorId}`,
      payload: { canManageSystemAdmins: true } });
    expect(selfPromotion.statusCode).toBe(404);
    expect(store.administrators.find((item) => item.id === monitorId)?.canManageSystemAdmins).toBe(false);

    const { app: signedOut } = appFor(() => null);
    expect((await signedOut.inject("/api/v1/system/administrators")).statusCode).toBe(404);
  });

  it("validates new administrator credentials before hashing", async () => {
    const { app } = appFor((current) => sessionOf(current, firstManagerId));
    const weak = await app.inject({ method: "POST", url: "/api/v1/system/administrators",
      payload: { email: "weak@arden.local", fullName: "Weak", password: "weakpassword" } });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe("INVALID_PASSWORD");
    const email = await app.inject({ method: "POST", url: "/api/v1/system/administrators",
      payload: { email: "not-an-email", fullName: "Bad", password: "StrongPassword!2" } });
    expect(email.statusCode).toBe(400);
  });
});
