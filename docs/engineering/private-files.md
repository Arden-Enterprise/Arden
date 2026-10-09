# Keep private files out of the public repository

Arden's repository and its review discussions are public. Keep private or security-critical material local or in approved private storage. This guide contains paths and placeholders only; obtain real values through an approved private channel.

## Ask Codex for help

Open a Codex chat in your Arden checkout and ask:

> Help me set up private local configuration for this project. Follow AGENTS.md and docs/engineering/private-files.md. Use placeholders in public examples, verify Git exclusions and tracking, and tell me where to enter real values locally. Do not request, print, or publish credentials.

For an existing local file, give its local path without pasting its contents:

> Check whether `.private/settings.json` is excluded and untracked. Use filename and Git checks only. If it needs public setup documentation, write a placeholder-only example and guide. Do not stage or publish the private file.

Codex can prepare exclusions, safe templates, and instructions. Enter passwords, tokens, and key passphrases directly in local tooling or approved secret storage. Do not paste them into the chat, GitHub issues, PRs, or review comments. A reviewer without local private files can still review public code and examples.

## Choose a location

| Material | Where it belongs |
| --- | --- |
| Local environment values | An ignored `.env` or `.env.<environment>` file in the appropriate application directory. |
| Passwords, API tokens, and private keys | Approved secret storage or authentication tooling; use a local environment file only when the application requires it. SSH private keys stay outside the checkout. |
| Necessary local sensitive settings, operational notes, backups, or data exports | The ignored `.private/` directory at the checkout root, or approved private storage outside the checkout. Limit stored data to what the task requires. |
| Private server connection profile | Local Git metadata resolved with `git rev-parse --git-path info/server-access.local.md`; follow the [server access guide](server-access.md). |
| Shared setup instructions and configuration shape | Versioned documentation and placeholder-only examples such as `.env.example` or `.env.sample`. |

Important shared code, architecture decisions, and sanitized documentation remain versioned. Choose exclusions based on sensitivity, and keep private material separate from those shared files.

The root `.gitignore` excludes `.env` variants, the root `.private/` directory, and common private-key/container extensions. Its `.env.example` and `.env.sample` exceptions are only for safe public templates. Never put actual values in these templates or place a private file under a safe-looking example name.

Ignored files are ordinary local files: ignoring does not encrypt them or stop local tools, backups, or people with filesystem access from reading them. Check editor uploads and artifacts separately. [Git ignore reference](https://git-scm.com/docs/gitignore)

## Set up your local files

From the checkout root, create the private directory if you need it.

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force .private | Out-Null
```

macOS/Linux:

```sh
mkdir -p .private
chmod 700 .private
```

You can put a necessary local settings file at `.private/settings.json`. Keep its contents private. A new clone does not include this directory's files, so each contributor sets up their own local values and access.

When the application provides `.env.example`, copy it to the documented local `.env` path without overwriting an existing file. Fill in real values locally using the team's private setup instructions. If no template exists, ask Codex to create one based on the application's actual configuration requirements.

A public environment example should look like this, with variable names adjusted to the application:

```dotenv
SERVICE_ENDPOINT=REPLACE_LOCALLY
SERVICE_TOKEN=REPLACE_LOCALLY
```

These placeholders are not working configuration. Do not include real service addresses, accounts, tokens, or production values. A guide should explain what each setting does, where it is read, and how an authorized contributor obtains its value privately.

For a private file that must live elsewhere, add a general path or pattern to the shared `.gitignore` before creating its sensitive contents. Do not expose a person's name, server address, or private project identifier in an ignore pattern. For an exclusion specific to your own checkout, open the file resolved by `git rev-parse --git-path info/exclude` and add the pattern locally. [Choosing shared and local ignore rules](https://git-scm.com/docs/gitignore)

## Check exclusions before committing

Use filename checks without displaying file contents. These commands work in PowerShell and common macOS/Linux shells:

```sh
git check-ignore -v -- .private/settings.json
git ls-files --cached -- .private/settings.json
```

The first should show the exclusion. The second must print nothing: it checks the current Git index, including files already tracked or newly staged. To check a local environment file, substitute its path, for example `.env`. [Git exclusion inspection reference](https://git-scm.com/docs/git-check-ignore)

If `git ls-files --cached` prints the private path, the file is already in the index. Stop before committing or pushing it. Do not run a diff that exposes its contents in public output. An ignore rule does not stop tracking an existing file. [Tracked files and ignore rules](https://git-scm.com/docs/gitignore)

Before a public commit, review the list of proposed filenames:

```sh
git diff --cached --name-only
git status --short
```

Stage only intended public files. Never use `git add -f` for private material. Public guides, templates, screenshots, issue descriptions, PRs, and CI artifacts must also contain no private values. Keep even filename-check output private if the names themselves are sensitive.

## If a private file was already staged or committed

Adding an ignore rule is insufficient. Ask Codex to preserve the local file and assess its tracking without quoting its contents:

> A private file may have been staged or committed. Check its tracking using filenames only, preserve my local copy, and prepare a safe fix. Explain whether history cleanup or credential rotation needs a maintainer. Do not print the values or rewrite shared history automatically.

For an indexed file, Git provides `git rm --cached -- PATH_TO_PRIVATE_FILE` to stop tracking while preserving the working copy. Have Codex or a maintainer confirm the path and state first; this does not erase earlier commits. [Stopping tracking](https://git-scm.com/docs/gitignore)

If a credential reached GitHub, revoke or rotate it promptly through the responsible administrator. Removing a file in a later commit does not erase earlier public copies. Coordinate history cleanup with a maintainer and follow [GitHub's sensitive-data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository). Report the affected path privately without copying the secret into an issue or PR.

## Share access privately

Document how to obtain access in the public guide. Share actual values only through the approved private channel, and give each contributor their own credentials where supported. CI and deployments use their platform's secret storage; public examples and logs contain no secret values.

Maintainers should configure available secret scanning and push protection in the repository's GitHub security settings; see [GitHub's security features](https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats). Exclusion rules and reviews remain necessary because scanners do not detect every kind of private material.
