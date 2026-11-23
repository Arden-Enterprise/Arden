# Private Notes organization: Maestro web flows

End-to-end flows for [F03-ORG collections, favorites and trash](../../../docs/product/identity-and-access.md) (ADR 0029), driven by [Maestro](https://maestro.dev) against the web app in demo mode. No API, database or account is needed: the demo session keeps private notes in memory and resets on each launch.

These flows exercise the UI only. They are not evidence for the server or RLS acceptance paths (owner-only access, purge job, If-Match conflicts).

## Prerequisites

- Node 24 and pnpm 11 (`pnpm install --frozen-lockfile`).
- Maestro CLI 2.12 or later, with Google Chrome installed. Web support in Maestro is beta.
- Java 17. If Java is not on `PATH`, pass `-JavaHome`; the runner sets `JAVA_HOME` for its own process only.

## Run

1. Start the web app (Vite, `127.0.0.1:5180`, strict port):

   ```sh
   pnpm dev:web
   ```

2. In another terminal, run the flows:

   ```sh
   pnpm e2e:private-notes
   # or, with explicit tool paths (Windows example):
   pwsh -NoProfile -File e2e/maestro/private-notes/run.ps1 -MaestroPath D:\maestro\bin\maestro.bat -JavaHome "C:\Program Files\Eclipse Adoptium\jdk-17.0.21.10002-hotspot"
   ```

   Options: `-Target <file-or-folder>` (relative to this folder, e.g. `06-trash-and-restore.yaml` or `smoke`), `-CheckSyntax` (runs `maestro check-syntax` on every flow, no browser). `MAESTRO_BIN` and `MAESTRO_JAVA_HOME` can replace `-MaestroPath` and `-JavaHome`.

3. Stop the dev server when done. Maestro writes screenshots, the UI hierarchy and logs to `~/.maestro/tests/<timestamp>/`.

## Layout

| Path | Purpose |
| --- | --- |
| `01`–`08-*.yaml` | Feature flows. Each is independent and starts a fresh demo session. |
| `subflows/` | Shared steps: demo login, create collection/note, inline title entry, row menu, Trash. Not run on their own. |
| `smoke/` | Harness check against the pre-feature Private Notes page (login + page opens). |
| `config.yaml` | Runs only the top-level flows when the folder is the target. |

| Flow | Acceptance path |
| --- | --- |
| `01-create-and-rename-collection` | F03-ORG-AC2 |
| `02-create-note-in-collection` | F03-ORG-AC2 |
| `03-favorite-and-unfavorite` | F03-ORG-AC3 (reload persistence not covered: demo resets on reload) |
| `04-duplicate-note` | F03-ORG-AC4 (note only) |
| `05-move-note` | F03-ORG-AC2 |
| `06-trash-and-restore` | F03-ORG-AC5 |
| `07-delete-permanently` | F03-ORG-AC6 (UI part) |
| `08-account-menu` | F03-ORG scope: account menu, Trash retention text |

## UI contract the flows rely on

Maestro web matches `text:` against rendered text (`innerText`, so CSS `text-transform` matters) and `id:` against an element's `id`, `aria-label` or `title`. Icon-only controls are therefore selected with `id:` and must keep these accessible names:

- `New collection`, `New note` (Private Notes header buttons)
- `More actions for <title>` (row and note-header `···`; the sidebar row is matched with `index: 0`)
- `Add a note to <title>` (collection `+`)
- `Add to favorites` / `Remove from favorites` (note-header star, and the same visible text in the menu)

Visible text: `Duplicate`, `Rename`, `Move to`, `Move to…` (submenu heading), `Current` (current destination), `Move to trash`, `Trash`, `Restore`, `Delete permanently`, `Cancel` (confirmation dialog), `Settings`, `Log out` (demo: `Exit preview`), `Favorites` (case-insensitive), `Deletes in 30 days`, `Items in trash are permanently deleted after 30 days.`, `Trash is empty.`

Behaviour assumed from the approved prototype: creating a collection or note, and Rename, open an autofocused inline title input that commits on Enter. The account button is found by the demo member name `Lan Nguyen`.

## Maestro web limits found while writing these flows

- `pressKey: Escape` is not supported on web; close menus by tapping outside (`tapOn: point`).
- The disabled state of a button is not reported; assert visible text inside it with `childOf`.
- Icon-only buttons are matched by `id:` (Maestro reads `aria-label` as the resource id), not `text:`.
- The confirm dialog renders in the top status island, before the page content in DOM order.
