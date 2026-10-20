# Custom-role UI preview

The shared web/Electron UI now includes a Discord-inspired role list and Display,
Permissions and Members sections, using Arden's Living Archive tokens rather
than Discord colors. Open the frontend's **Open admin preview**, then **Roles &
permissions**. The server-managed Administration page also includes a separate,
explicitly labeled configuration preview below the existing role creation form.

## Boundary

- This is UI-only. Apply, reset, role creation and member add/remove in this panel
  never call an administration mutation API and never change authorization.
- Sample mode starts with Reader and Contributor examples. In live Administration,
  names and member IDs are a snapshot of loaded custom roles. Current permission
  grants are not returned by that API, so the switches start empty as preview
  settings; they must not be interpreted as the live role's effective rights.
- Changes remain in component memory, not localStorage. Reloading or leaving the
  administration page clears them. Sample section tabs preserve the mounted panel.
  Unapplied changes have Apply/Reset controls and a before-unload warning; sample
  shell navigation also uses its existing dirty-state guard.
- Only Read published knowledge, Write shared drafts and Submit for review are
  configurable in this preview. The two draft capabilities are proposed API work,
  not enforced permissions merely because the UI displays them.
- Private workspace rights remain personal defaults and are never configurable
  here. Org Admin/default department role configuration is excluded. Reviewer
  grants remain separate; there is no publication, search or AI switch.
- The existing server role creation/assignment forms still operate separately.
  Applying a configuration preview does not update those forms or effective-access
  sample cards.

## Next integration slice

Add typed role-detail/permission catalog and mutation APIs, server-side validation,
audit and migration/RLS tests before connecting this panel to persistent changes.
Preserve the owner/private boundary and protect management permissions. Explicitly
resolve audience behavior on role deactivation and permission removal. UI model
tests do not prove any of those authorization properties.
