import { describe, expect, it } from "vitest";
import { membershipAccessDescription, needsDepartmentAssignment } from "../src/shared/membershipAssignment";

describe("hosted membership assignment status", () => {
  it("keeps an active department-free member in the waiting room even with private workspace permission", () => {
    expect(needsDepartmentAssignment({
      organization: { id: "org-1", name: "Test Organization" },
      status: "active", departmentId: null, roleCodes: ["MEMBER"], canUsePrivateWorkspace: true,
    })).toBe(true);
  });

  it("keeps the organization administrator exception", () => {
    expect(needsDepartmentAssignment({
      organization: { id: "org-1", name: "Test Organization" },
      status: "active", departmentId: null, roleCodes: ["ORG_ADMIN"], canUsePrivateWorkspace: true,
    })).toBe(false);
  });

  it("does not send inactive memberships to the waiting room", () => {
    expect(needsDepartmentAssignment({
      organization: { id: "org-1", name: "Test Organization" },
      status: "suspended", departmentId: null, roleCodes: ["MEMBER"], canUsePrivateWorkspace: false,
    })).toBe(false);
  });

  it("does not claim private workspace access when the server denies it", () => {
    expect(membershipAccessDescription({
      organization: { id: "org-1", name: "Test Organization" },
      status: "active", departmentId: null, departmentName: null,
      roleCodes: ["MEMBER"], canUsePrivateWorkspace: false,
    })).toBe("Member");
  });

  it("uses a readable administrator label without exposing role codes", () => {
    expect(membershipAccessDescription({
      organization: { id: "org-1", name: "Test Organization" },
      status: "active", departmentId: null, roleCodes: ["ORG_ADMIN"], canUsePrivateWorkspace: true,
    })).toBe("Organization Admin");
  });
});
