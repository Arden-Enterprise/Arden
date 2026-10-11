# Private project server access

This is a generic onboarding guide for authorized contributors. Obtain real connection details through the team's private channel. Keep those details out of this public repository, review comments, issues, and CI output.

For environment files, credentials, sensitive notes, and other local material, follow the [private files guide](private-files.md), including its examples for asking Codex to help without exposing private values.

## Where private details live

Codex reads this repository's [AGENTS.md](../../AGENTS.md), which directs it to a local profile only when the user requests server work. The profile's path is resolved from inside the checkout:

```sh
git rev-parse --git-path info/server-access.local.md
```

Open the returned path in a text editor. It is inside local Git metadata and cannot be included in a normal Git commit. Using Git to resolve the path also works when a worktree's `.git` is a file rather than a directory. These notes are local to this repository's Git metadata; they are not global Codex instructions and are not supplied by a fresh clone.

In Windows PowerShell, you can create the parent directory and open the note:

```powershell
$projectServerProfile = git rev-parse --git-path info/server-access.local.md
New-Item -ItemType Directory -Force (Split-Path -Parent $projectServerProfile) | Out-Null
notepad $projectServerProfile
```

On macOS/Linux, resolve the path and create its parent, then open the file using your preferred editor:

```sh
project_server_profile="$(git rev-parse --git-path info/server-access.local.md)"
mkdir -p "$(dirname "$project_server_profile")"
```

Use this private profile template, replacing the placeholders locally:

```markdown
# Private project server profile

- SSH alias: YOUR_SERVER_ALIAS
- Expected hostname: SERVER_HOST_FROM_ADMIN
- Expected SSH port: SERVER_PORT_FROM_ADMIN
- Approved remote account: YOUR_APPROVED_SERVER_USER
- Local identity file: YOUR_LOCAL_KEY_PATH
- Sudo permissions: THE_POLICY_APPROVED_FOR_YOUR_ACCOUNT
- Application paths and services: RECORD_ONLY_ADMIN_APPROVED_DETAILS

Use this profile only for server tasks requested in this project.
Keep its real values out of public files, commits, issues, PRs, and logs.
```

The note is ordinary local text, not an encrypted credential vault. Store only connection metadata there. Passwords, private keys, tokens, and production data belong in SSH tooling or approved secret storage. Do not upload the local profile as a reviewer artifact or copy it into tracked files.

A reviewer or CI agent with no private profile can still review the repository; missing server access is not a reason to ask reviewers for credentials. [OpenAI's project instructions documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

## Each contributor sets up their own access

Ask an administrator to confirm your approved account, connection hostname and port, host fingerprint, and permitted operations through a private channel. An approved existing account is acceptable. Different contributors can use different accounts and keys.

Configure SSH in the environment where Codex executes: Windows, WSL, macOS, Linux, or an explicitly authorized remote environment. A cloud chat does not automatically receive local keys or an SSH agent. Codex can use ordinary SSH commands; this workflow does not require a new public Codex service.

## Create a key and authorize its public half

Run `ssh -V` locally to check for the OpenSSH client. If unavailable, install it through the operating system's supported process.

The examples below use the generic key filename `project_server_key`. Each contributor generates their own key material. Reuse an existing approved key if appropriate, and do not overwrite a key when prompted.

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\project_server_key" -C "project server access"
Get-Content "$env:USERPROFILE\.ssh\project_server_key.pub"
```

macOS/Linux:

```sh
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/project_server_key -C "project server access"
cat ~/.ssh/project_server_key.pub
```

Choose a passphrase to protect the private key. Send only the `.pub` contents to the administrator through the approved channel. The administrator installs the public key for your approved server account. Keep the private key outside the checkout and never send it to another contributor or paste it in chat. [OpenSSH key generation reference](https://man.openbsd.org/ssh-keygen)

## Configure your local SSH alias

Use `$env:USERPROFILE\.ssh\config` in Windows PowerShell, or `~/.ssh/config` on macOS/Linux. This SSH client configuration is personal to an execution environment; the Codex instructions remain scoped to the project.

On Windows, open the file with:

```powershell
notepad "$env:USERPROFILE\.ssh\config"
```

Append the following block while preserving other host entries. Replace every placeholder using the privately supplied details before connecting. Set the port to the administrator's numeric value:

```sshconfig
Host YOUR_SERVER_ALIAS
    HostName SERVER_HOST_FROM_ADMIN
    Port SERVER_PORT_FROM_ADMIN
    User YOUR_APPROVED_SERVER_USER
    IdentityFile ~/.ssh/project_server_key
    IdentitiesOnly yes
    ForwardAgent no
```

Use your actual key path if you chose a different filename. Save the file as exactly `config`, without a `.txt` extension. In Windows Notepad's Save As dialog, choose **All files**. The local terminal's current directory may differ from your home directory. [OpenSSH client configuration reference](https://man.openbsd.org/ssh_config)

## Verify the destination and unlock the key

Replace `YOUR_SERVER_ALIAS` in each command with the alias recorded in your private profile. Inspect settings locally:

```sh
ssh -G YOUR_SERVER_ALIAS
```

Compare the hostname, port, user, and identity path to your private profile. Configuration inspection does not establish a connection, and its output may reveal connection metadata; keep it out of public logs and comments.

Connect interactively once:

```sh
ssh YOUR_SERVER_ALIAS
```

Compare the host fingerprint with the administrator's value through a trusted channel before accepting it. Stop on a changed host key and verify the change; do not disable checking or blindly delete the saved key. Once connected, `id -un` confirms the remote account. Use `exit` to return to the local terminal.

To avoid entering the key passphrase for every connection, load it into an SSH agent. On Windows, enable the service once from administrator PowerShell if needed:

```powershell
Set-Service -Name ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

Then load the key from regular PowerShell:

```powershell
ssh-add "$env:USERPROFILE\.ssh\project_server_key"
```

Enter the key passphrase at the local prompt. [Microsoft's Windows key and agent guide](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement)

On macOS/Linux with a session agent available:

```sh
ssh-add ~/.ssh/project_server_key
```

If Bash or Zsh has no available agent, start one for that terminal:

```sh
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/project_server_key
```

Codex must run in an environment that can access the agent. A new terminal agent may not be available to an already-running app. Use a session agent or launch Codex from that terminal as appropriate. The agent permits processes under your local account to use the key; it is not exclusive to Codex. [OpenSSH agent reference](https://man.openbsd.org/ssh-agent)

Check unattended login from Codex's execution environment:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 YOUR_SERVER_ALIAS 'id -un'
```

It should return your approved remote username without a password or passphrase prompt. Keep that output private.

## Administrator access and daily work

SSH login does not imply root access. Use the permissions the administrator grants to your account. When permitted, `sudo -n -l` can inspect the policy, and Codex uses `sudo -n` for the specific authorized operation to avoid unattended password prompts. A policy listing does not grant every command; different accounts can have different permissions. [Ubuntu sudo reference](https://manpages.ubuntu.com/manpages/noble/man8/sudo.8.html)

If a password is required, enter it directly in an interactive terminal. For approved unattended operations, ask the administrator to configure appropriate permissions. Do not enable root SSH login or broaden access merely to get past a failed command.

Open a Codex chat in this checkout and describe the server task. The public project instructions point to the local private profile. Codex should use that profile, inspect relevant state, stay within the requested scope, and report results without revealing connection metadata.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| SSH treats your alias as a hostname and uses defaults | Check the correct execution environment's `config` file, saved host block, and a possible hidden `.txt` extension. |
| Server account password prompt or `Permission denied (publickey)` | Check the configured account/key and the public key authorized by the administrator. |
| Repeated key-passphrase prompt, or BatchMode fails after an interactive key login succeeds | Load the key into the agent available to Codex. |
| Unknown or changed host key | Verify the fingerprint privately with the administrator. |
| Sudo requires a password or denies the command | Check the account's policy; use an interactive terminal or appropriate administrator-approved access. |

New clones need their own private profile and approved SSH setup. When access is revoked, the administrator removes the relevant authorized key or account access. Distribute connection profiles through approved private storage rather than this public repository.
