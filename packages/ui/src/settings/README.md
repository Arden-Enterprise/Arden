# Arden Settings Architecture & Extension Guide

Arden includes a modular Settings system designed for easy extension by team members.
Settings sections are decoupled from the modal dialog shell and can be registered either statically or dynamically.

---

## How to Add a New Settings Section (Tab)

Adding a new settings tab requires only **two simple steps**:

### Step 1: Create your settings section component
In `packages/ui/src/settings/sections/`, create your component (e.g. `AppearanceSettingsSection.tsx` or `AISettingsSection.tsx`).
The component receives `SettingsSectionProps`:

```tsx
import type { SettingsSectionProps } from "../types";

export function AppearanceSettingsSection({ platform, session }: SettingsSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Appearance</h2>
        <p>Customize themes, typography, and density.</p>
      </div>

      <section className="settings-card">
        <h3 className="settings-card-title">Theme</h3>
        {/* Your controls here */}
      </section>
    </div>
  );
}
```

### Step 2: Register your section in `registry.ts`
Open `packages/ui/src/settings/registry.ts` and add your section to `defaultSettingsSections`:

```tsx
import { AppearanceSettingsSection } from "./sections/AppearanceSettingsSection";

export const defaultSettingsSections: SettingsSection[] = [
  accountSettingsSection,
  {
    id: "appearance",
    label: "Appearance",
    icon: "layers", // IconName or custom ReactNode
    description: "Theme and visual preferences",
    component: AppearanceSettingsSection,
    order: 20, // Lower numbers appear first
  },
];
```

That's it! Your section will automatically:
1. Appear in the left sidebar tab list with its icon and label.
2. Switch dynamically when clicked.
3. Inherit responsive styles, Island dark theme tokens, and keyboard accessibility.

---

## Dynamic Registration (For Plugins or Optional Features)

If your feature is loaded dynamically or in a separate package, you can also register and unregister at runtime:

```tsx
import { registerSettingsSection } from "@arden/ui";

const unregister = registerSettingsSection({
  id: "ai",
  label: "Arden AI",
  icon: "chat",
  component: AISettingsSection,
  order: 15,
});

// To remove on unmount / disable:
unregister();
```

---

## Props Provided to Each Section (`SettingsSectionProps`)

| Prop | Type | Description |
| --- | --- | --- |
| `platform` | `"web" \| "desktop"` | Current platform environment |
| `session` | `CurrentSession \| null` | Authenticated user session or null if in preview |
| `organization` | `OrganizationPreview \| null` | Current organization details |
| `memberName` | `string \| undefined` | User display name or email |
| `memberRole` | `string \| undefined` | User role (e.g. "Organization Admin", "Member") |
| `memberDepartment` | `string \| undefined` | Assigned primary department |
| `onClose` | `() => void` | Function to close the Settings dialog |
| `onRefreshSession` | `(() => Promise<void>) \| undefined` | Re-fetch session from server after mutations |
| `onSignOut` | `(() => void) \| undefined` | Trigger sign out / exit preview |

