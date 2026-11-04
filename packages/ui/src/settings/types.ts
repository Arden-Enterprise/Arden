import type { ReactNode } from "react";
import type { Platform } from "../shared/types";
import type { CurrentSession } from "../shared/api-client";
import type { OrganizationPreview } from "../organization/previewModel";
import type { IconName } from "../shared/Icon";

/**
 * Props provided to every settings section component.
 * Teammates implementing new settings tabs can read any of these props
 * to interact with user session, organization, or platform context.
 */
export type SettingsSectionProps = {
  platform: Platform;
  session: CurrentSession | null;
  organization: OrganizationPreview | null;
  organizationName?: string;
  memberName?: string;
  memberRole?: string;
  memberDepartment?: string;
  onClose: () => void;
  onRefreshSession?: () => Promise<void>;
  onSignOut?: () => void;
};

/**
 * Contract for a settings section/tab.
 * To add a new settings section to the app, define an object matching this interface
 * and register it in `packages/ui/src/settings/registry.ts`.
 */
export type SettingsSection = {
  /** Unique identifier for the section (e.g. "account", "ai", "appearance") */
  id: string;
  /** Label displayed in the settings sidebar navigation */
  label: string;
  /** Icon name from the shared icon set or a custom ReactNode */
  icon?: IconName | ReactNode;
  /** Optional short description displayed in the section header */
  description?: string;
  /** Optional badge text or count shown next to the tab in navigation */
  badge?: string | number;
  /** React component rendering the settings controls */
  component: React.ComponentType<SettingsSectionProps>;
  /**
   * Sort priority (lower numbers appear first in the tab list).
   * Account defaults to 10. Default for custom sections is 100.
   */
  order?: number;
};

