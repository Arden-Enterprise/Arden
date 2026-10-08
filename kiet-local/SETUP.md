# Kiet's private development setup

Prepared 5 October 2026. Keep this packet private: it contains internal connection settings, but no passwords, private keys, database credentials or administrator tokens.

## What is ready

Your named Coolify slot is **kiet-local** (internal ID `dev-2`). Its API and logical development database are running on the server. Your ordinary server account is prepared, with a locked password and no administrator/Docker group membership. It can upload backend code and run only its exact slot startup helper with sudo.

**Your supplied public key was registered on 5 October 2026. You can now try your first login using the matching private key on your own computer.** Nobody needs to give you their operator account/password/key. Your own computer runs the frontend and editor; the server runs your API/database. A Coolify invitation is a separate dashboard permission, and is not needed to start the coding command after SSH access is ready.

Your slot currently uses the Fastify/PostgreSQL scaffold. Zack alone has the full Supabase pilot. Auth/Storage/Realtime/Studio have not been deployed separately for your slot. This packet does not grant access to Zack's Supabase administrator account or staging/production. Product screens/functions are still being implemented.

For manual frontend testing without login, no project-wide test-mode variable is needed. The API automatically selects the fixed mock account only for the dedicated `dev-2` target (`NODE_ENV=development`, PostgreSQL host `postgres`, database `arden_dev_2`, no Supabase URL/key). The API remains loopback-only and is reached through the SSH tunnel. Run `pnpm.cmd dev:remote` from your checkout and open `http://127.0.0.1:5180/`; the fixed test actor can create core Flow 1 records without login. Invitations are stored in the development database. They send actual email only after all six SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) are configured in Coolify. The emailed test link points to your local frontend and cannot be opened from another device.

## 1. Install/check the tools on your own computer

Use the official [Git installer](https://git-scm.com/install/) and [Node download](https://nodejs.org/en/download), selecting **Node 24 LTS** for the repository's pinned toolchain. Windows normally supplies OpenSSH; if `ssh -V` is missing, ask your computer administrator to enable the Windows OpenSSH Client optional feature. Close and reopen your terminal after installation.

In Windows PowerShell:

```powershell
git --version
node --version
ssh -V
npm.cmd install --global pnpm@11.19.0
pnpm.cmd --version
```

Expected Node major version: 24. Expected pnpm: 11.19.0. On macOS/Linux, use `npm` and `pnpm` instead of `npm.cmd` and `pnpm.cmd`. You do not need Docker on your own computer for this hosted workflow. If installing a global tool is denied, ask for help with your Node installation; do not run repository scripts as administrator.

## 2. Keep your existing key

Zack supplied your public key and it is now registered. You have already completed key creation; do not generate another key or overwrite the existing one.

Keep the matching private key and passphrase on your computer. The connection entry expects `~/.ssh/arden_dev_ed25519`. On Windows this is the file `arden_dev_ed25519` in your user profile's `.ssh` directory. If your existing key is in another location, update only `IdentityFile` in the companion SSH entry to that local private-key path. Do not send the private key to Zack or Codex.

Continue with step 3. You do not need a server login password.

## 3. Add your connection settings

The companion `ssh-config.txt` contains the exact prepared connection entry. Add its contents to your existing SSH config, keeping other entries. On Windows:

```powershell
notepad "$env:USERPROFILE\.ssh\config"
```

Save the filename as **config**, with no `.txt` extension. If Notepad asks for a file type, choose **All files**. On macOS/Linux, edit `~/.ssh/config` and run `chmod 600 ~/.ssh/config`. Use your own local key; the default key path above works on both platforms. If you already use another approved public key, adjust only `IdentityFile` to its private counterpart's local path.

## 4. Verify your first login

The approved server **ED25519** fingerprint is:

```text
SHA256:a23B85xn9fXsTyfAroUUYGza58qoPSUzQjwUSB57kH4
```

It matches the existing operator's pinned known-host record and the server's public host key. Compare it exactly on your first connection. Use this first-login command so OpenSSH can prompt for that verified host key:

```powershell
ssh -o StrictHostKeyChecking=ask -o HostKeyAlgorithms=ssh-ed25519 arden-kiet-local
```

Type `yes` only if the shown ED25519 fingerprint matches. If it differs, stop and ask Zack/Hung to investigate. This one command enrolls the verified key; daily commands keep strict host checking enabled. Enter your own key passphrase locally if requested. If it asks for a **server account password**, stop and ask the administrator to check key registration.

After login, run `id -un`; it should print `arden-kiet`. Run `exit` to return to your computer.

Load your key into your computer's SSH agent:

```powershell
ssh-add "$env:USERPROFILE\.ssh\arden_dev_ed25519"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes arden-kiet-local id -un
```

The second command must print your username without asking for a password/passphrase. If Windows says the agent is unavailable, a local computer administrator can run `Set-Service ssh-agent -StartupType Automatic` and `Start-Service ssh-agent` once in an administrator PowerShell. Then run `ssh-add` again in your ordinary terminal. Use matching Windows OpenSSH `ssh`/`ssh-add`; mixing Git's SSH with Windows' agent can fail. On macOS/Linux, use `ssh-add ~/.ssh/arden_dev_ed25519` with your session agent; if none exists in Bash/Zsh, start one with `eval "$(ssh-agent -s)"`.

## 5. Download Arden and add your private project settings

In a directory where you keep projects (use a new empty `Arden` destination):

```powershell
git clone https://github.com/Arden-Enterprise/Arden.git
Set-Location Arden
git switch -c feat/kiet-first-task
New-Item -ItemType Directory -Force .private | Out-Null
```

Copy this packet's **remote.json** into the checkout as `.private/remote.json`, using your file manager. If a private settings file already exists, preserve it and ask before replacing it. Your completed settings are:

```json
{
  "sshAlias": "arden-kiet-local",
  "remoteRoot": "/srv/arden-hosted",
  "defaultSlot": "dev-2",
  "localApiPort": 3001
}
```

Keep these real settings out of GitHub, Linear and public screenshots. Verify exclusion and install:

```powershell
git check-ignore .private/remote.json
git ls-files .private/remote.json
pnpm.cmd install --frozen-lockfile
```

The first command must print the private path. The second must print nothing. If either result differs, stop before committing. macOS/Linux users run `mkdir -p .private`, `chmod 700 .private`, and `chmod 600 .private/remote.json`; their command is `pnpm install --frozen-lockfile`.

## 6. Start coding

From your Arden checkout:

```powershell
pnpm.cmd remote:status
pnpm.cmd dev:remote
```

On macOS/Linux, omit `.cmd`. Leave the terminal running. The command reserves your slot, uploads allowed backend files, starts/checks your managed API, opens a private SSH tunnel and starts the local frontend. First dependency installation can take a few minutes. Wait for readiness and open the printed URL, normally **http://127.0.0.1:5180/**. It currently shows the sample Arden UI.

Edit UI in `packages/ui/src/ArdenShell.tsx` and `packages/ui/src/styles.css`; web integration is in `apps/web`. Saved UI changes reload locally. Edit server code in `apps/api/src`; allowed backend files sync and the server watcher restarts. `packages/domain`, `packages/db`, `packages/ai`, and `packages/api-client` are also within the backend sync scope. SQL is uploaded only; migrations are not executed automatically. Database schema/deployment changes need the separately reviewed operator workflow.

Press **Ctrl+C** in the development terminal when done. It stops your local frontend/tunnels and releases your writer reservation, while server data remains. After a crash, a reservation expires after five minutes. Keep one writer session per slot and stop it before switching Git branches.

The account/startup/sync permissions were checked using your Unix identity on the server. Key registration is complete. Your real SSH authentication, first code upload, edit/reload and Ctrl+C cleanup still need confirmation on your computer. Tell Zack/Hung which step failed, with a sanitized error.

## Common problems

| Problem | Next action |
| --- | --- |
| Alias cannot be resolved | Check `config` was saved without `.txt`, and contains your companion SSH entry. |
| Permission denied/server password prompt | Confirm your own `.pub` was registered; check key path and `ssh-add`. |
| Host fingerprint mismatch | Stop and contact Zack/Hung; do not disable host checking. |
| pnpm PowerShell script is blocked | Use `pnpm.cmd` as shown. |
| Writer busy | Close your other session; after a crash wait five minutes. |
| Maintenance message | Wait for the operator, then restart your command. |
| Port 3001 or 5180 is occupied | Stop your previous owned Arden session. Do not kill all Node/SSH processes. |
| sudo/startup denied | Ask the operator to check the exact slot grant; do not use someone else's administrator login. |
| Coolify project is not visible | Ask for a separate scoped invitation; this does not change SSH login. |

## Daily routine

Open your task branch, load your key if necessary, run `pnpm.cmd dev:remote`, edit and save. Stop with Ctrl+C before changing branches. Commit coherent task-owned files, push when ready, and use a PR for the configured AI reviewers. Read the public [teammate guide](https://github.com/Arden-Enterprise/Arden/blob/main/docs/engineering/teammate-setup.md) and repository contribution rules for checks/review; its older deployment-status paragraphs are superseded by this dated private packet.

**Do not commit this packet, your remote.json, SSH config, keys, credentials or private server information.**
