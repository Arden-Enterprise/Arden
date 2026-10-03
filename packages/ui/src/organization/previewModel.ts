export type PrimaryRole = "Employee" | "Manager / Knowledge Reviewer" | "System Admin";

export type Department = {
  id: string;
  name: string;
};

export type OrganizationMember = {
  id: string;
  name: string;
  email: string;
  departmentId: string;
  role: PrimaryRole;
};

export type OrganizationPreview = {
  name: string;
  templateId: string;
  departments: Department[];
  members: OrganizationMember[];
};

export const primaryRoles: PrimaryRole[] = [
  "Employee",
  "Manager / Knowledge Reviewer",
  "System Admin",
];

export const previewTemplates = [
  {
    id: "product-operations",
    name: "Product & operations",
    description: "A compact structure for a product team and its operating partners.",
    departments: ["Product Engineering", "Operations"],
  },
  {
    id: "service-delivery",
    name: "Service delivery",
    description: "A starting point for customer-facing and internal service teams.",
    departments: ["Customer Services", "People Operations"],
  },
] as const;

export const accessRules = [
  {
    scope: "Company-wide",
    audience: "Authorized organization members",
    detail: "Department membership does not narrow an item deliberately published for the organization.",
  },
  {
    scope: "Department",
    audience: "Members of the selected department",
    detail: "Other departments need a deliberate grant; a role label alone does not grant access.",
  },
  {
    scope: "Private",
    audience: "The owner and explicitly authorized people",
    detail: "Managers and System Admins do not automatically see private content.",
  },
] as const;

export function createPreviewOrganization(templateId: string = previewTemplates[0].id): OrganizationPreview {
  const template = previewTemplates.find((item) => item.id === templateId) ?? previewTemplates[0];
  const departments = template.departments.map((name, index) => ({
    id: `department-${index + 1}`,
    name,
  }));

  return {
    name: "Northstar Studio",
    templateId: template.id,
    departments,
    members: [
      {
        id: "sample-admin",
        name: "Alex Morgan",
        email: "alex@northstar.example",
        departmentId: departments[0].id,
        role: "System Admin",
      },
      {
        id: "sample-employee",
        name: "Lan Nguyen",
        email: "lan@northstar.example",
        departmentId: departments[0].id,
        role: "Employee",
      },
      {
        id: "sample-reviewer",
        name: "Minh Tran",
        email: "minh@northstar.example",
        departmentId: departments[1].id,
        role: "Manager / Knowledge Reviewer",
      },
      {
        id: "sample-operations-employee",
        name: "Samira Patel",
        email: "samira@northstar.example",
        departmentId: departments[1].id,
        role: "Employee",
      },
    ],
  };
}

export function validateOrganization(organization: OrganizationPreview): string[] {
  const problems: string[] = [];
  const departmentNames = organization.departments.map((item) => item.name.trim().toLowerCase());
  const memberEmails = organization.members.map((item) => item.email.trim().toLowerCase());

  if (!organization.name.trim()) problems.push("Enter an organization name.");
  if (organization.departments.length < 2) {
    problems.push("The demo configuration needs at least two departments.");
  }
  if (departmentNames.some((name) => !name)) problems.push("Name every department.");
  if (new Set(departmentNames).size !== departmentNames.length) {
    problems.push("Department names must be unique.");
  }
  if (organization.members.some((member) => !member.name.trim())) {
    problems.push("Name every member.");
  }
  if (organization.members.some((member) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email.trim()))) {
    problems.push("Give every member a valid email address.");
  }
  if (new Set(memberEmails).size !== memberEmails.length) {
    problems.push("Member email addresses must be unique.");
  }
  if (organization.members.some((member) => !organization.departments.some((department) => department.id === member.departmentId))) {
    problems.push("Assign every member to an existing department.");
  }
  if (!organization.members.some((member) => member.role === "System Admin")) {
    problems.push("Keep at least one System Admin in the demo configuration.");
  }
  if (!organization.members.some((member) => member.role === "Manager / Knowledge Reviewer")) {
    problems.push("Add a Manager / Knowledge Reviewer to the demo configuration.");
  }
  if (organization.departments.some((department) => !organization.members.some((member) => member.departmentId === department.id && member.role === "Employee"))) {
    problems.push("Add an Employee to each department for the permission-boundary demo.");
  }

  return problems;
}
