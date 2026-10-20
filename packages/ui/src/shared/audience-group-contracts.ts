export type AudienceGroupWrite = { name: string; description: string };
export type AudienceGroupMember = {
  id: string;
  membershipId: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  validFrom: string;
  validUntil: string | null;
};
export type AudienceGroupRecord = AudienceGroupWrite & {
  id: string;
  version: number;
  status: "ACTIVE" | "INACTIVE";
  members: AudienceGroupMember[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || !value || Array.isArray(value)) {
    throw new Error("Invalid audience group response.");
  }
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) {
    throw new Error("Invalid audience group identifier.");
  }
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid audience group membership timestamp.");
  }
  return value;
}

export function parseAudienceGroup(value: unknown): AudienceGroupRecord {
  const group = record(value);
  if (typeof group.name !== "string" || typeof group.description !== "string"
    || typeof group.version !== "number" || !Number.isSafeInteger(group.version) || group.version <= 0
    || (group.status !== "ACTIVE" && group.status !== "INACTIVE")
    || !Array.isArray(group.members)) throw new Error("Invalid audience group configuration.");
  const members = group.members.map((value: unknown): AudienceGroupMember => {
    const member = record(value);
    if (member.status !== "ACTIVE" && member.status !== "REVOKED" && member.status !== "EXPIRED") {
      throw new Error("Invalid audience group membership status.");
    }
    return {
      id: id(member.id),
      membershipId: id(member.membershipId),
      status: member.status,
      validFrom: timestamp(member.validFrom),
      validUntil: member.validUntil === null ? null : timestamp(member.validUntil),
    };
  });
  return { id: id(group.id), name: group.name, description: group.description,
    status: group.status, version: group.version, members };
}

export function parseAudienceGroupList(value: unknown): AudienceGroupRecord[] {
  const list = record(value);
  if (!Array.isArray(list.items)) throw new Error("Invalid audience group list.");
  return list.items.map(parseAudienceGroup);
}

