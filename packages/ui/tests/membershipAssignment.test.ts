import { describe, expect, it } from "vitest";
import { needsDepartmentAssignment } from "../src/shared/membershipAssignment";

describe("hosted membership assignment status", () => {
  it("keeps an active department-free member in the waiting room even with private workspace permission", () => {
    expect(needsDepartmentAssignment({
      status: "active", departmentId: null, roleCodes: ["MEMBER"], canUsePrivateWorkspace: true,
    })).toBe(true);
  });

  it("keeps the organization administrator exception", () => {
    expect(needsDepartmentAssignment({
      status: "active", departmentId: null, roleCodes: ["ORG_ADMIN"], canUsePrivateWorkspace: true,
    })).toBe(false);
  });

  it("does not send inactive memberships to the waiting room", () => {
    expect(needsDepartmentAssignment({
      status: "suspended", departmentId: null, roleCodes: ["MEMBER"], canUsePrivateWorkspace: false,
    })).toBe(false);
  });
});
