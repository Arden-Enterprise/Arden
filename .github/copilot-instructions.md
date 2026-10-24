# Arden review context

Follow the repository's [AGENTS.md](../AGENTS.md) entry point and [rule index](../docs/engineering/rules/README.md). The canonical policies live in the linked modules; maintain them there instead of copying them into this adapter.

Load the task, Git, security, and PR modules for review. For application changes also load engineering, verification, and quality metrics; for visible changes load design. Server operations apply only to explicitly authorized server work. Use only public repository context; never request credentials or local private profiles.

Report concrete defects with file/line evidence, especially access, publication, stale retrieval, external confirmation, failures, and missing applicable verification. Compare the current revision with the intended base. Identify unavailable context, skipped files, stale review coverage, and unexecuted checks.

Human PR review is optional. AI approval or a score does not replace executed verification; coverage gaps must be reported honestly. Publishing, reviewer requests, merge, deployment, and paid usage follow the authorization rules in the shared modules.
