import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const types = "feat|fix|docs|refactor|perf|test|chore|build|ci|release|hotfix|security|revert";
const branchPattern = new RegExp(`^(${types})/(.+)$`);
const descriptionPattern = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const prohibitedDescription = /^(?:new-branch|changes|work|final|\d{4}-\d{2}-\d{2})$/;
const versionNumber = "(?:0|[1-9][0-9]*)";
const prereleaseIdentifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const versionPattern = new RegExp(`^${versionNumber}\\.${versionNumber}\\.${versionNumber}(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const titlePattern = new RegExp(`^(?:${types})(?:\\([a-z0-9]+(?:-[a-z0-9]+)*\\))?!?: (\\S.*)$`, "u");
const forbiddenCharacters = /[\u0000-\u001f\u007f\u2028\u2029]/u;

export function validatePullRequest(input) {
  const data = input && typeof input === "object" ? input : {};
  const { branch, title, author } = data;
  if (author === "dependabot[bot]" && typeof branch === "string" && branch.startsWith("dependabot/")) {
    return { exempt: true, errors: [] };
  }
  const errors = [];
  const match = typeof branch === "string" ? branchPattern.exec(branch) : null;
  if (!match || branch.length > 80 || forbiddenCharacters.test(branch)
    || (match[1] !== "release" && prohibitedDescription.test(match[2]))
    || !(match[1] === "release" ? versionPattern : descriptionPattern).test(match[2])) {
    errors.push("Use type/specific-kebab-description or release/semver, with at most 80 characters; do not add a tool/agent prefix.");
  }
  const titleMatch = typeof title === "string" ? titlePattern.exec(title) : null;
  if (!titleMatch || forbiddenCharacters.test(title) || title !== title.trim()
    || Array.from(title).length > 100 || Array.from(titleMatch[1]).length < 8) {
    errors.push("Use a Conventional Commit PR title with a summary of at least eight characters and at most 100 characters in the complete title.");
  }
  return { exempt: false, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = validatePullRequest({
    branch: process.env.PR_BRANCH,
    title: process.env.PR_TITLE,
    author: process.env.PR_AUTHOR,
  });
  for (const error of result.errors) console.log(`::error::${error}`);
  if (result.errors.length) process.exitCode = 1;
  else console.log(result.exempt ? "Dependabot naming exemption applies." : "Branch and PR title follow Arden conventions.");
}
