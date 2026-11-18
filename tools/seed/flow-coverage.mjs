// Create one durable example of every flow state the live API can store.
// Instructions: tools/seed/flow-coverage.md
//
// From the Arden checkout that contains this file:
//   $env:ARDEN_SEED_PASSWORD = "<shared fixture password>"
//   node tools/seed/flow-coverage.mjs

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const password = process.env.ARDEN_SEED_PASSWORD;
const catalog = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), "flow-cases.json"), "utf8"));
const results = [];

if (!password) {
  console.error("Set ARDEN_SEED_PASSWORD to the shared fixture password, then run this again.");
  process.exit(1);
}

function record(id, outcome, detail) {
  const existing = results.find((item) => item.id === id);
  if (existing) {
    existing.outcome = outcome;
    existing.detail = detail;
  } else {
    results.push({ id, outcome, detail });
  }
  console.log(`${outcome.padEnd(8)} ${id}: ${detail}`);
}

function account(id) {
  const found = catalog.accounts.find((item) => item.id === id);
  if (!found) throw new Error(`Missing catalog account ${id}`);
  return found;
}

function publicDetail(result) {
  const code = result.payload?.error?.code;
  const message = result.payload?.error?.message;
  if (code || message) return `${result.status} ${[code, message].filter(Boolean).join(": ")}`;
  if (typeof result.payload === "string") return `${result.status} ${result.payload.slice(0, 160)}`;
  return `HTTP ${result.status}`;
}

function routeMissing(result) {
  return result.status === 404 && !result.payload?.error?.code;
}

function versionOf(draft) {
  return draft.currentVersion?.version ?? draft.currentVersion;
}

function bodyText(sentence) {
  return `${sentence}\nThis fixture exists so the matching screen can be opened without creating the record by hand.`;
}

class Session {
  constructor(email) {
    this.email = email;
    this.cookies = new Map();
  }

  async request(method, path, body, extraHeaders = {}, base = baseUrl) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        origin: "http://127.0.0.1:5180",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookies.size === 0 ? {} : { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const rows = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const row of rows) {
      const pair = row.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = text; }
    }
    return { status: response.status, payload };
  }
}

async function chooseBase() {
  for (const candidate of ["http://127.0.0.1:5180", "http://127.0.0.1:3001"]) {
    try {
      const response = await fetch(`${candidate}/api/health/live`);
      if (response.ok) return candidate;
    } catch { /* try the next local port */ }
  }
  throw new Error("Neither http://127.0.0.1:5180 nor http://127.0.0.1:3001 responded.");
}

const baseUrl = await chooseBase();
console.log(`Using ${baseUrl}`);

function invitationToken(result) {
  const payload = result.payload;
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["token", "invitationToken", "acceptToken"]) {
    if (typeof payload[key] === "string" && /^[A-Za-z0-9_-]{43}$/.test(payload[key])) return payload[key];
  }
  if (typeof payload.invitationUrl === "string") {
    const part = payload.invitationUrl.split("/").at(-1) ?? "";
    if (/^[A-Za-z0-9_-]{43}$/.test(part)) return part;
  }
  return null;
}

async function signIn(id) {
  const fixture = account(id);
  const session = new Session(fixture.email);
  const signedIn = await session.request("POST", "/api/v1/auth/sign-in", { email: fixture.email, password });
  if (signedIn.status !== 200 || !signedIn.payload?.authenticated) {
    throw new Error(`${fixture.email} could not sign in (${signedIn.status}).`);
  }
  const me = await session.request("GET", "/api/v1/me");
  if (me.status !== 200) throw new Error(`${fixture.email} could not read the signed-in profile (${me.status}).`);
  return { id, session, me: me.payload, fixture };
}

function inOrganization(actor, organizationId) {
  return (actor.me.memberships ?? []).some((item) => item.organization?.id === organizationId && item.status === "active");
}

async function refresh(actor) {
  const me = await actor.session.request("GET", "/api/v1/me");
  if (me.status === 200) actor.me = me.payload;
  return actor;
}

const actors = {
  admin: await signIn("F02-org-admin"),
  member: await signIn("F02-member"),
  departmentReviewer: await signIn("F05-department-reviewer"),
  organizationReviewer: await signIn("F05-organization-reviewer"),
  systemAdmin: await signIn("F06-system-admin"),
};
record("F01-password-sign-in", "ready", "All five fixture accounts signed in.");

let organizationId = null;
let practiceDepartmentId = null;
let author = actors.admin;
let draftContract = "audience";
let topicId = null;
const maintenanceSkip = "The process on port 3001 does not serve Flow 4 maintenance routes, so this case was not stored.";

async function administration() {
  const response = await actors.admin.session.request("GET", `/api/v1/organizations/${organizationId}/administration`);
  if (response.status !== 200) throw new Error(`Organization administration returned ${publicDetail(response)}.`);
  return response.payload;
}

async function ensureOrganization() {
  const existing = (actors.admin.me.memberships ?? []).find((item) => item.organization?.name === catalog.organizationName && item.status === "active");
  if (existing) {
    organizationId = existing.organization.id;
    record("F02-organization", "ready", "Arden Flow Practice was already present.");
    return;
  }
  const created = await actors.admin.session.request("POST", "/api/v1/organizations", {
    name: catalog.organizationName,
    departmentName: "Practice",
  });
  if (created.status !== 201) throw new Error(`Creating Arden Flow Practice returned ${publicDetail(created)}.`);
  organizationId = created.payload?.organization?.organizationId ?? created.payload?.organizationId ?? null;
  await refresh(actors.admin);
  if (!organizationId) {
    organizationId = (actors.admin.me.memberships ?? []).find((item) => item.organization?.name === catalog.organizationName)?.organization?.id ?? null;
  }
  if (!organizationId) throw new Error("Arden Flow Practice was created but its id was not returned.");
  record("F02-organization", "ready", "Created Arden Flow Practice without changing the admin's other organizations.");
}

async function ensureDepartments() {
  let overview = await administration();
  const names = () => new Set((overview.departments ?? []).map((item) => item.name));
  for (const name of catalog.departments) {
    if (names().has(name)) continue;
    const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/departments`, { name });
    if (created.status !== 201 && created.status !== 409) {
      throw new Error(`Department ${name} returned ${publicDetail(created)}.`);
    }
  }
  overview = await administration();
  const practice = (overview.departments ?? []).find((item) => item.name === "Practice");
  const coverage = (overview.departments ?? []).find((item) => item.name === "Coverage");
  if (!practice || !coverage) throw new Error("Practice or Coverage is missing after department setup.");
  practiceDepartmentId = practice.id;
  record("F02-departments", "ready", "Practice and Coverage are available.");
  return overview;
}

function activeMember(overview, email) {
  return (overview.members ?? []).find((item) => item.email?.toLowerCase() === email && String(item.status).toUpperCase() === "ACTIVE");
}

async function ensureMembership(email, canAccept) {
  let overview = await administration();
  const present = activeMember(overview, email);
  if (present) return { state: "active", membershipId: present.id };
  const pending = (overview.invitations ?? []).find((item) => item.email?.toLowerCase() === email && String(item.status).toUpperCase() === "PENDING");
  if (pending) return { state: "pending" };
  const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/invitations`, {
    email,
    departmentId: practiceDepartmentId,
  });
  if (created.status === 503) return { state: "unavailable" };
  if (created.status === 409) return { state: "pending" };
  if (created.status === 502) return { state: "saved-undelivered" };
  if (created.status !== 202) return { state: "failed", detail: publicDetail(created) };
  const token = invitationToken(created);
  if (!token) return { state: "no-token" };
  if (!canAccept) return { state: "needs-session" };
  const actor = Object.values(actors).find((item) => item.fixture.email === email);
  if (!actor) return { state: "needs-session" };
  const accepted = await actor.session.request("POST", "/api/v1/invitations/accept", { token });
  if (accepted.status !== 204 && accepted.status !== 200) return { state: "accept-failed", detail: publicDetail(accepted) };
  await refresh(actor);
  overview = await administration();
  const joined = activeMember(overview, email);
  return joined ? { state: "active", membershipId: joined.id } : { state: "accept-unconfirmed" };
}

function membershipDetail(email, result) {
  if (result.state === "active") return `${email} is an active member.`;
  if (result.state === "unavailable") return "Invitation email is not configured, so the membership could not be created.";
  if (result.state === "pending" || result.state === "no-token" || result.state === "saved-undelivered") {
    return `A pending invitation for ${email} is saved. The invitation response does not include an accept token, so this seed cannot accept it the way the app does.`;
  }
  if (result.state === "needs-session") {
    return `An invitation for ${email} was saved with an accept token, but this seed cannot sign in as that account to accept it.`;
  }
  return `Membership for ${email} was not attached (${result.detail ?? result.state}).`;
}

async function trackedInvitation(spec) {
  const overview = await administration();
  const invites = (overview.invitations ?? []).filter((item) => item.email?.toLowerCase() === spec.email);
  const pending = invites.find((item) => String(item.status).toUpperCase() === "PENDING");
  const revoked = invites.some((item) => String(item.status).toUpperCase() === "REVOKED");
  if (!spec.revoke && pending) return "already pending";
  if (spec.revoke && pending) {
    const removed = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/invitations/${pending.id}/revoke`);
    if (removed.status !== 204 && removed.status !== 200) throw new Error(publicDetail(removed));
    return "revoked";
  }
  if (spec.revoke && revoked) return "already revoked";
  const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/invitations`, {
    email: spec.email,
    departmentId: practiceDepartmentId,
  });
  if (created.status === 503) return "unavailable";
  if (created.status === 409) return spec.revoke ? "already closed" : "already pending";
  if (![202, 502].includes(created.status)) throw new Error(publicDetail(created));
  if (!spec.revoke) return created.status === 502 ? "saved, mail not confirmed" : "pending";
  const invitationId = created.payload?.invitationId;
  if (!invitationId) return "saved without an id";
  const removed = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/invitations/${invitationId}/revoke`);
  if (removed.status !== 204 && removed.status !== 200) throw new Error(publicDetail(removed));
  return "revoked";
}

async function drafts(session) {
  const list = await session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/drafts`);
  if (list.status !== 200) throw new Error(`Draft list returned ${publicDetail(list)}.`);
  return new Map((list.payload.items ?? []).map((item) => [item.title, item]));
}

async function submissions(session) {
  const list = await session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/submissions`);
  if (list.status !== 200) throw new Error(`Submission list returned ${publicDetail(list)}.`);
  return list.payload.items ?? [];
}

async function ensureDraft(spec) {
  const existing = (await drafts(author.session)).get(spec.title);
  if (existing) return existing;
  const created = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/drafts/new`, {
    title: spec.title,
    body: bodyText(spec.sentence),
    classification: spec.classification,
  }, { "idempotency-key": randomUUID() });
  if (created.status !== 201 && created.status !== 200) throw new Error(publicDetail(created));
  return created.payload;
}

async function reloadDraft(title) {
  const found = (await drafts(author.session)).get(title);
  if (!found) throw new Error(`${title} disappeared after it was saved.`);
  return found;
}

async function patchDraft(draft, patch) {
  const updated = await author.session.request("PATCH", `/api/v1/organizations/${organizationId}/knowledge/drafts/${draft.id}`, patch, {
    "if-match": `"${versionOf(draft)}"`,
  });
  if (updated.status < 200 || updated.status >= 300) {
    const error = new Error(publicDetail(updated));
    error.result = updated;
    throw error;
  }
  return updated.payload;
}

async function detectContract(sample) {
  const catalogList = await actors.admin.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/catalog`);
  if (routeMissing(catalogList)) return "audience";
  if (catalogList.status !== 200) return "audience";
  const topic = (catalogList.payload.topics ?? []).find((item) => item.name === catalog.catalogTopic.name);
  if (topic) topicId = topic.id;
  if (!topicId) {
    const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/catalog/topics`, {
      name: catalog.catalogTopic.name,
      description: catalog.catalogTopic.description,
      status: "ACTIVE",
    });
    if (created.status === 201 || created.status === 200) topicId = created.payload?.id ?? null;
    if (created.status === 409) {
      const again = await actors.admin.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/catalog`);
      topicId = (again.payload?.topics ?? []).find((item) => item.name === catalog.catalogTopic.name)?.id ?? null;
    }
  }
  if (!topicId) return "audience";
  try {
    await patchDraft(sample, {
      targetReaders: { mode: "ORGANIZATION" },
      management: {
        type: "Guide",
        topicId,
        version: "1.0",
        effectiveDate: "2026-01-15",
        expirationDate: null,
        changeNote: "",
      },
    });
    return "staging";
  } catch (error) {
    if (error.result?.status === 400) return "audience";
    throw error;
  }
}

async function prepareDraft(draft, spec) {
  const current = await reloadDraft(spec.title);
  if (draftContract === "staging") {
    return patchDraft(current, {
      classification: spec.classification,
      targetReaders: { mode: "ORGANIZATION" },
      management: {
        type: spec.type ?? "Guide",
        topicId,
        version: "1.0",
        effectiveDate: "2026-01-15",
        expirationDate: null,
        changeNote: "",
      },
    });
  }
  const options = await author.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/options`);
  if (options.status !== 200) throw new Error(publicDetail(options));
  const audience = (options.payload.audiences ?? []).find((item) => item.kind === "ORGANIZATION_ALL");
  const departmentId = options.payload.primaryDepartmentId ?? practiceDepartmentId;
  if (!audience || !departmentId) throw new Error("The organization has no organization-wide audience or primary department.");
  return patchDraft(current, {
    classification: spec.classification,
    responsibleDepartmentId: departmentId,
    targetScopeType: "ORGANIZATION",
    audienceIds: [audience.id],
    teamTag: "People",
    projectTag: "Flow coverage",
  });
}

function isReady(draft) {
  return Boolean(draft.targetReaders) || (draft.audienceIds ?? []).length > 0;
}

async function submitDraft(draft) {
  const current = await reloadDraft(draft.title);
  const submitted = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/drafts/${current.id}/submit`, undefined, {
    "idempotency-key": randomUUID(),
    "if-match": `"${versionOf(current)}"`,
  });
  if (submitted.status < 200 || submitted.status >= 300) throw new Error(publicDetail(submitted));
  return submitted.payload;
}

async function decide(title, action, comment) {
  const reviewers = [actors.organizationReviewer, actors.departmentReviewer, actors.admin]
    .filter((actor) => inOrganization(actor, organizationId));
  for (const reviewer of reviewers) {
    const queue = await reviewer.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/reviews`);
    if (queue.status !== 200) continue;
    const item = (queue.payload.items ?? []).find((entry) => entry.title === title);
    const submissionId = item?.submissionId ?? item?.id;
    if (!submissionId) continue;
    const detail = await reviewer.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/reviews/${submissionId}`);
    if (detail.status !== 200) continue;
    const decision = await reviewer.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/reviews/${submissionId}/decisions`, {
      action,
      expectedSnapshotVersionId: detail.payload.snapshotVersionId,
      expectedContentHash: detail.payload.contentHash,
      comment,
    }, { "idempotency-key": randomUUID() });
    if (decision.status >= 200 && decision.status < 300) return decision.payload;
  }
  return null;
}

async function libraryDraft(spec) {
  const history = () => submissions(author.session).then((items) => items.filter((item) => item.title === spec.title));
  const finished = (await history()).find((item) => item.status === spec.keep);
  if (finished) {
    if (spec.keep === "APPROVED") {
      return finished.publicationState === "ACTIVE"
        ? "already published"
        : `already approved, publication ${finished.publicationState ?? "PREPARING"} until the indexer finishes`;
    }
    return `already ${finished.status}`;
  }
  const draft = await ensureDraft(spec);
  if (spec.keep === "UNPREPARED") return isReady(draft) ? "already prepared" : "saved without readers";
  const pending = (await history()).find((item) => item.status === "PENDING_REVIEW");
  if (!pending && !draft.hasPendingSubmission) {
    const prepared = isReady(draft) && draft.classification === spec.classification ? draft : await prepareDraft(draft, spec);
    if (spec.keep === "READY") return "ready to submit";
    await submitDraft(prepared.title ? prepared : { title: spec.title });
  } else if (spec.keep === "READY") {
    return "already submitted";
  }
  if (spec.keep === "PENDING_REVIEW") return "awaiting review";
  if (spec.keep === "WITHDRAWN") {
    const open = (await history()).find((item) => item.status === "PENDING_REVIEW");
    if (!open) throw new Error(`${spec.title} has no pending submission to withdraw.`);
    const withdrawn = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/submissions/${open.id}/withdraw`);
    if (routeMissing(withdrawn)) throw new Error("ROUTE_MISSING");
    if (withdrawn.status < 200 || withdrawn.status >= 300) throw new Error(publicDetail(withdrawn));
    return "withdrawn";
  }
  const decided = await decide(spec.title, spec.action, spec.comment ?? null);
  if (!decided) throw new Error(`${spec.title} was not in a reviewer queue.`);
  if (spec.keep === "REJECTED") return "rejected with a comment";
  const latest = (await history()).find((item) => item.status === "APPROVED");
  return latest?.publicationState === "ACTIVE"
    ? "published"
    : `approved, publication ${latest?.publicationState ?? "PREPARING"} until the indexer finishes`;
}

async function maintenanceAvailable() {
  const probeId = "00000000-0000-4000-8000-000000000099";
  const body = {
    origin: "READER_REPORT",
    documentId: probeId,
    publishedVersionId: probeId,
    description: "Route probe that names no real document.",
  };
  const primary = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases`, body, { "idempotency-key": randomUUID() });
  if (!routeMissing(primary)) return true;
  const secondary = await actors.admin.session.request("POST", `/api/v1/organizations/${probeId}/knowledge/maintenance/cases`, body, { "idempotency-key": randomUUID() }, "http://127.0.0.1:3001");
  return !routeMissing(secondary);
}

function caseStatus(item) {
  return item?.reporterStatus ?? item?.status ?? "";
}

async function listMaintenance(actor, scope) {
  const list = await actor.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases?scope=${scope}`);
  if (list.status !== 200) throw new Error(publicDetail(list));
  return list.payload.items ?? list.payload ?? [];
}

async function seedMaintenance(spec, published) {
  if (!published?.id || !(published.draftId ?? published.id)) {
    record(spec.id, "skipped", "No current publication is readable yet, so this maintenance case was not stored.");
    return;
  }
  const reporter = spec.origin === "REVIEWER_INTAKE"
    ? [actors.departmentReviewer, actors.organizationReviewer].find((actor) => inOrganization(actor, organizationId) && actor.id !== author.id)
    : [actors.member, actors.admin].find((actor) => inOrganization(actor, organizationId));
  if (!reporter) {
    record(spec.id, "skipped", "No eligible account is a member of Arden Flow Practice, so this maintenance case was not stored.");
    return;
  }
  const created = await reporter.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases`, {
    origin: spec.origin,
    documentId: published.draftId ?? published.id,
    publishedVersionId: published.id,
    description: spec.description,
    anchor: { page: 1, passage: "Flow practice fixture passage." },
  }, { "idempotency-key": spec.idempotencyKey });
  if (routeMissing(created)) {
    record(spec.id, "skipped", maintenanceSkip);
    return;
  }
  if (created.status < 200 || created.status >= 300) {
    record(spec.id, "skipped", publicDetail(created));
    return;
  }
  const found = created.payload ?? {};
  if (spec.keep === "Reassigned") {
    const history = await actors.admin.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases/${found.caseId}/history`);
    if ((history.payload?.items ?? []).some((item) => item.eventType === "REASSIGNED")) {
      record(spec.id, "ready", "Already reassigned.");
      return;
    }
  } else if (spec.keep === "Submitted" || caseStatus(found) === spec.keep || (spec.keep === "In Progress" && caseStatus(found) === "Resolved")) {
    record(spec.id, "ready", `${spec.origin} is ${caseStatus(found) || spec.keep}.`);
    return;
  }
  if (spec.keep === "Submitted") {
    record(spec.id, "ready", `${spec.origin} is ${caseStatus(found) || "Submitted"}.`);
    return;
  }
  const reviewer = [actors.departmentReviewer, actors.organizationReviewer].find((actor) => inOrganization(actor, organizationId) && actor.fixture.email !== reporter.fixture.email);
  if (!reviewer && spec.keep !== "Reassigned") {
    record(spec.id, "skipped", "The case was stored, but no independent reviewer membership is available to move it.");
    return;
  }
  let revision = found.revision;
  if (spec.keep === "Reassigned") {
    const target = actors.organizationReviewer;
    if (!inOrganization(target, organizationId)) {
      record(spec.id, "skipped", "The organization reviewer is not a member, so the case could not be reassigned.");
      return;
    }
    const overview = await administration();
    const membershipId = activeMember(overview, target.fixture.email)?.id;
    if (!membershipId) {
      record(spec.id, "skipped", "The organization reviewer membership id was not available.");
      return;
    }
    const moved = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases/${found.caseId}/reassign`, {
      expectedRevision: revision,
      membershipId,
      reason: "Move this fixture case to the organization reviewer.",
    }, { "idempotency-key": spec.commandKey });
    if (moved.status < 200 || moved.status >= 300) {
      record(spec.id, "skipped", publicDetail(moved));
      return;
    }
    record(spec.id, "ready", "Reassigned to the organization reviewer.");
    return;
  }
  if (caseStatus(found) === "Submitted") {
    const claimed = await reviewer.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases/${found.caseId}/claim`, {
      expectedRevision: revision,
    }, { "idempotency-key": spec.commandKey });
    if (claimed.status < 200 || claimed.status >= 300) {
      record(spec.id, "skipped", publicDetail(claimed));
      return;
    }
    revision = claimed.payload?.revision ?? revision + 1;
    if (spec.keep === "In Progress") {
      record(spec.id, "ready", "Claimed and left in progress.");
      return;
    }
  }
  const resolved = await reviewer.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases/${found.caseId}/decisions`, {
    expectedRevision: revision,
    reporterExplanation: "The published text already answers this report.",
    reviewerRationale: "No publication change is required for this fixture.",
  }, { "idempotency-key": spec.decideKey ?? spec.commandKey });
  if (resolved.status < 200 || resolved.status >= 300) {
    record(spec.id, "skipped", publicDetail(resolved));
    return;
  }
  record(spec.id, "ready", "Resolved as no change needed.");
}

try {
  await ensureOrganization();
  await ensureDepartments();

  const fixtureResults = [];
  for (const id of ["F02-member", "F05-department-reviewer", "F05-organization-reviewer"]) {
    const email = account(id).email;
    fixtureResults.push(membershipDetail(email, await ensureMembership(email, true)));
  }
  await Promise.all(Object.values(actors).map((actor) => refresh(actor)));
  const fixtureJoined = ["F02-member", "F05-department-reviewer", "F05-organization-reviewer"]
    .every((id) => inOrganization(actors[id === "F02-member" ? "member" : id === "F05-department-reviewer" ? "departmentReviewer" : "organizationReviewer"], organizationId));
  record("F02-fixture-members", fixtureJoined ? "ready" : "skipped", fixtureResults.join(" "));

  for (const spec of catalog.invitations) {
    const outcome = await trackedInvitation(spec);
    if (outcome === "unavailable") record(spec.id, "skipped", "Invitation email is not configured on this API.");
    else record(spec.id, "ready", `Invitation is ${outcome}.`);
  }

  const overview = await administration();
  const grants = await actors.admin.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/reviewer-grants`);
  if (grants.status !== 200) {
    record("F02-reviewer-grants", "skipped", publicDetail(grants));
  } else {
    const grantItems = grants.payload.items ?? [];
    let grantNotes = [];
    for (const [email, scope] of [
      [account("F05-department-reviewer").email, "DEPARTMENT"],
      [account("F05-organization-reviewer").email, "ORGANIZATION"],
    ]) {
      const membershipId = activeMember(overview, email)?.id;
      if (!membershipId) {
        grantNotes.push(`${email} is not a member`);
        continue;
      }
      const existing = grantItems.find((item) => item.reviewerMembershipId === membershipId && item.scope === scope && item.status === "ACTIVE");
      if (existing) continue;
      const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/reviewer-grants`, {
        reviewerMembershipId: membershipId,
        scope,
        departmentId: scope === "DEPARTMENT" ? practiceDepartmentId : null,
        validUntil: null,
      });
      if (created.status !== 201 && created.status !== 409) grantNotes.push(publicDetail(created));
    }
    record("F02-reviewer-grants", grantNotes.length ? "skipped" : "ready",
      grantNotes.length ? grantNotes.join("; ") : "Department and organization reviewer grants are active.");
  }

  const groups = await actors.admin.session.request("GET", `/api/v1/organizations/${organizationId}/audience-groups`);
  if (routeMissing(groups)) {
    record("F02-audience-group", "skipped", "This API has no audience group route.");
  } else if (groups.status !== 200) {
    record("F02-audience-group", "skipped", publicDetail(groups));
  } else {
    let group = (groups.payload.items ?? []).find((item) => item.name === catalog.audienceGroup.name);
    if (!group) {
      const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/audience-groups`, catalog.audienceGroup);
      if (created.status !== 201 && created.status !== 409) throw new Error(publicDetail(created));
      group = created.payload;
    }
    const memberId = activeMember(overview, account("F02-member").email)?.id;
    if (memberId && group?.id && !(group.members ?? []).some((item) => item.membershipId === memberId)) {
      await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/audience-groups/${group.id}/members`, { membershipId: memberId });
    }
    record("F02-audience-group", "ready", `${catalog.audienceGroup.name} is available.`);
  }

  author = inOrganization(actors.member, organizationId) ? actors.member : actors.admin;
  const contractSample = await ensureDraft(catalog.documents.find((item) => item.keep === "READY"));
  if (!isReady(contractSample)) draftContract = await detectContract(contractSample);
  else draftContract = contractSample.targetReaders ? "staging" : "audience";

  const catalogList = await actors.admin.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/catalog`);
  if (routeMissing(catalogList)) {
    record("F02-catalog-topic", "skipped", "This API has no knowledge catalog route.");
    record("F02-catalog-collection", "skipped", "This API has no knowledge catalog route.");
  } else if (catalogList.status !== 200) {
    record("F02-catalog-topic", "skipped", publicDetail(catalogList));
    record("F02-catalog-collection", "skipped", publicDetail(catalogList));
  } else {
    const topics = catalogList.payload.topics ?? [];
    if (!topics.some((item) => item.name === catalog.catalogTopic.name) && !topicId) {
      const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/catalog/topics`, {
        name: catalog.catalogTopic.name, description: catalog.catalogTopic.description, status: "ACTIVE",
      });
      if (created.status === 201 || created.status === 200) topicId = created.payload?.id ?? topicId;
    }
    record("F02-catalog-topic", topicId || topics.some((item) => item.name === catalog.catalogTopic.name) ? "ready" : "skipped",
      topicId || topics.some((item) => item.name === catalog.catalogTopic.name) ? `${catalog.catalogTopic.name} is active.` : "The topic was not stored.");
    const collections = catalogList.payload.collections ?? [];
    if (!collections.some((item) => item.name === catalog.catalogCollection.name)) {
      const created = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/catalog/collections`, {
        name: catalog.catalogCollection.name,
        description: catalog.catalogCollection.description,
        status: "ACTIVE",
        cover: catalog.catalogCollection.cover,
        documentIds: [],
      });
      if (created.status !== 201 && created.status !== 200 && created.status !== 409) {
        record("F02-catalog-collection", "skipped", publicDetail(created));
      } else {
        record("F02-catalog-collection", "ready", `${catalog.catalogCollection.name} is active.`);
      }
    } else {
      record("F02-catalog-collection", "ready", `${catalog.catalogCollection.name} is active.`);
    }
  }

  for (const spec of catalog.notes) {
    const owner = Object.values(actors).find((item) => item.id === spec.owner);
    if (!owner || !inOrganization(owner, organizationId)) {
      record(spec.id, "skipped", `${account(spec.owner).email} is not a member of Arden Flow Practice, so this private note was not stored.`);
      continue;
    }
    const list = await owner.session.request("GET", `/api/v1/organizations/${organizationId}/private-workspace/drafts?limit=100`);
    if (list.status !== 200) {
      record(spec.id, "skipped", publicDetail(list));
      continue;
    }
    if ((list.payload.items ?? []).some((item) => item.title === spec.title)) {
      record(spec.id, "ready", "already present");
      continue;
    }
    const created = await owner.session.request("POST", `/api/v1/organizations/${organizationId}/private-workspace/drafts`, {
      title: spec.title,
      body: bodyText(spec.sentence),
    });
    record(spec.id, created.status === 201 ? "ready" : "skipped", created.status === 201 ? "created" : publicDetail(created));
  }
  if (inOrganization(actors.member, organizationId)) {
    const memberNotes = await actors.member.session.request("GET", `/api/v1/organizations/${organizationId}/private-workspace/drafts?limit=100`);
    const leaked = (memberNotes.payload?.items ?? []).some((item) => item.title === "Admin private desk note");
    if (leaked) record("F03-admin-private-note", "skipped", "The department member can see the organization admin's private note.");
  }

  const withdrawProbe = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/submissions/${randomUUID()}/withdraw`);
  const withdrawRoute = !routeMissing(withdrawProbe);
  for (const spec of catalog.documents) {
    if (spec.keep === "WITHDRAWN" && !withdrawRoute) {
      record(spec.id, "skipped", "This API has no submission withdraw route.");
      continue;
    }
    try {
      record(spec.id, "ready", `${spec.classification}: ${await libraryDraft(spec)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The document was not stored.";
      record(spec.id, message === "ROUTE_MISSING" ? "skipped" : "skipped", message === "ROUTE_MISSING" ? "This API has no submission withdraw route." : message);
    }
  }

  const expectedTitles = catalog.documents.filter((item) => item.keep === "APPROVED").map((item) => item.title);
  let publishedItems = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const published = await author.session.request("GET", `/api/v1/organizations/${organizationId}/knowledge/published`);
    publishedItems = published.status === 200 ? published.payload.items ?? [] : [];
    if (expectedTitles.every((title) => publishedItems.some((item) => item.title === title))) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const visible = expectedTitles.filter((title) => publishedItems.some((item) => item.title === title));
  record("F03-published-readable", visible.length === expectedTitles.length ? "ready" : "skipped",
    visible.length === expectedTitles.length
      ? "The author can list both approved publications."
      : `The library lists ${visible.length} of ${expectedTitles.length}. Approved items stay out of the library while publication is PREPARING.`);

  const published = publishedItems.find((item) => item.title === "Current workplace policy") ?? publishedItems[0] ?? null;
  const changeProbe = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/documents/${randomUUID()}/change-requests`, {
    type: "WITHDRAWAL",
    reason: "probe",
  }, { "idempotency-key": randomUUID() });
  if (routeMissing(changeProbe)) {
    record("F02-change-request", "skipped", "This API has no document change-request route.");
  } else if (!published?.draftId && !published?.id) {
    record("F02-change-request", "skipped", "No current publication is available, so a change request was not stored.");
  } else {
    const documentId = published.draftId ?? published.id;
    const existing = (await submissions(author.session)).find((item) => item.draftId === documentId && item.requestType === "WITHDRAWAL");
    if (existing) {
      record("F02-change-request", "ready", `already ${existing.status}`);
    } else {
      const requested = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/documents/${documentId}/change-requests`, {
        type: "WITHDRAWAL",
        reason: "Fixture request to withdraw this publication after review.",
      }, { "idempotency-key": randomUUID() });
      record("F02-change-request", requested.status >= 200 && requested.status < 300 ? "ready" : "skipped",
        requested.status >= 200 && requested.status < 300 ? "Withdrawal change request stored." : publicDetail(requested));
    }
  }

  const reportProbe = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/published/${randomUUID()}/reports`, { message: "probe" });
  if (routeMissing(reportProbe)) {
    record("F02-publication-report", "skipped", "This API has no publication report route.");
  } else if (!published?.id) {
    record("F02-publication-report", "skipped", "No readable publication is available to report.");
  } else {
    const reported = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/published/${published.id}/reports`, {
      message: "Fixture report so the open publication report can be inspected.",
    });
    const stored = reported.status === 201 || reported.payload?.error?.code === "ALREADY_REPORTED";
    record("F02-publication-report", stored ? "ready" : "skipped", stored ? "Report stored." : publicDetail(reported));
  }

  const withdrawalProbe = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/documents/${randomUUID()}/withdrawal`, {
    reason: "probe",
  });
  if (routeMissing(withdrawalProbe)) {
    record("F02-direct-withdrawal", "skipped", "This API has no direct publication withdrawal route.");
  } else {
    const restricted = publishedItems.find((item) => item.title === "Current restricted handling rule");
    if (!restricted?.draftId && !restricted?.id) {
      record("F02-direct-withdrawal", "skipped", "The restricted publication is not current yet, so it was not withdrawn.");
    } else {
      const removed = await actors.admin.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/documents/${restricted.draftId ?? restricted.id}/withdrawal`, {
        reason: "Fixture withdrawal of the restricted handling rule.",
      });
      record("F02-direct-withdrawal", removed.status >= 200 && removed.status < 300 ? "ready" : "skipped",
        removed.status >= 200 && removed.status < 300 ? "Withdrawn by the organization admin." : publicDetail(removed));
    }
  }

  async function readerAttempt(id, path, requestBody, unavailable) {
    if (!published?.id) {
      record(id, "skipped", "No readable publication is available for this reader request.");
      return;
    }
    const response = await author.session.request("POST", `/api/v1/organizations/${organizationId}/knowledge/published/${published.id}${path}`, requestBody);
    if (routeMissing(response)) record(id, "skipped", "This API does not expose that reader route.");
    else if (response.status >= 200 && response.status < 300) record(id, "ready", "The reader request completed.");
    else record(id, "skipped", `${unavailable} (${publicDetail(response)}).`);
  }
  await readerAttempt("F03-summary", "/summary", { requestId: randomUUID() }, "Summary was attempted and the AI service did not answer");
  await readerAttempt("F03-question", "/questions", { requestId: randomUUID(), query: "What does this fixture policy ask a reader to do?" }, "The document question was attempted and the AI service did not answer");

  const answer = await author.session.request("POST", `/api/v1/organizations/${organizationId}/ai/answers`, {
    query: "What does the current workplace policy say?",
  });
  if (routeMissing(answer)) record("F03-ask", "skipped", "This API has no Ask Arden route.");
  else if (answer.status >= 200 && answer.status < 300) record("F03-ask", "ready", `Ask Arden responded ${answer.payload?.status ?? "OK"}.`);
  else record("F03-ask", "skipped", `Ask Arden was attempted and is not available (${publicDetail(answer)}).`);

  const maintenanceRoute = await maintenanceAvailable();
  if (!maintenanceRoute) {
    for (const spec of catalog.maintenance) record(spec.id, "skipped", maintenanceSkip);
  } else {
    for (const spec of catalog.maintenance) {
      try { await seedMaintenance(spec, published); }
      catch (error) { record(spec.id, "skipped", error instanceof Error ? error.message : "The maintenance case was not stored."); }
    }
  }

  const allowed = await actors.systemAdmin.session.request("GET", "/api/v1/system/administrators");
  const hidden = await actors.admin.session.request("GET", "/api/v1/system/administrators");
  if (allowed.status === 200 && hidden.status === 404) {
    record("F06-system-admin-read", "ready", "Only the system admin can read installation administrators.");
  } else {
    record("F06-system-admin-read", "skipped", `System admin received ${allowed.status}; organization admin received ${hidden.status}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

for (const item of catalog.cases) {
  if (!results.some((result) => result.id === item.id)) record(item.id, "manual", item.summary);
}

console.log("\n| Case | Outcome | Detail |");
console.log("| --- | --- | --- |");
for (const item of results) console.log(`| ${item.id} | ${item.outcome} | ${item.detail.replaceAll("|", "/")} |`);
console.log(`\nFlow seed finished. ${results.length} checks recorded.`);
if (process.exitCode) process.exit(process.exitCode);
