import type { SettingsSection } from "./types";
import { AccountSettingsSection } from "./sections/AccountSettingsSection";

/**
 * Built-in default settings sections.
 * 
 * ============================================================================
 * HOW TO ADD A NEW SETTINGS TAB FOR YOUR FEATURE:
 * ============================================================================
 * 1. Create a component in `packages/ui/src/settings/sections/YourSettingsSection.tsx`
 *    accepting `SettingsSectionProps` (e.g. platform, session, organization).
 * 2. Add an entry to `defaultSettingsSections` below, or call `registerSettingsSection(...)`.
 * 3. Done! Your section will automatically appear in the Settings dialog.
 * 
 * Example:
 * ```tsx
 * export const defaultSettingsSections: SettingsSection[] = [
 *   accountSettingsSection,
 *   {
 *     id: "ai",
 *     label: "Arden AI",
 *     icon: "chat",
 *     description: "Configure AI models, retrieval parameters, and API keys",
 *     component: AISettingsSection,
 *     order: 20,
 *   },
 * ];
 * ```
 */

export const accountSettingsSection: SettingsSection = {
  id: "account",
  label: "Account",
  icon: "people",
  description: "Manage your profile, credentials, and session",
  component: AccountSettingsSection,
  order: 10,
};

export const defaultSettingsSections: SettingsSection[] = [
  accountSettingsSection,
];

/**
 * In-memory registry for dynamically registered settings sections.
 * Allows plugins or runtime modules to register custom sections without modifying core files.
 */
const dynamicSections: Map<string, SettingsSection> = new Map();
const sectionListeners = new Set<() => void>();

function notifySettingsSections(): void {
  for (const listener of sectionListeners) listener();
}

/**
 * Register a custom settings section dynamically.
 * Returns an unregister callback to clean up on unmount.
 */
export function registerSettingsSection(section: SettingsSection): () => void {
  dynamicSections.set(section.id, section);
  notifySettingsSections();
  return () => {
    dynamicSections.delete(section.id);
    notifySettingsSections();
  };
}

/**
 * Unregister a settings section by its ID.
 */
export function unregisterSettingsSection(id: string): void {
  dynamicSections.delete(id);
  notifySettingsSections();
}

/** Refresh open settings dialogs when a section is registered or removed. */
export function subscribeSettingsSections(listener: () => void): () => void {
  sectionListeners.add(listener);
  return () => {
    sectionListeners.delete(listener);
  };
}

/**
 * Returns all active settings sections sorted by `order` (ascending).
 * Any `extraSections` passed at invocation time are merged and take precedence.
 */
export function getRegisteredSettingsSections(extraSections?: SettingsSection[]): SettingsSection[] {
  const sectionsMap = new Map<string, SettingsSection>();

  // 1. Built-in defaults
  for (const section of defaultSettingsSections) {
    sectionsMap.set(section.id, section);
  }

  // 2. Dynamically registered sections
  for (const [id, section] of dynamicSections.entries()) {
    sectionsMap.set(id, section);
  }

  // 3. One-off extra sections passed to dialog props
  if (extraSections) {
    for (const section of extraSections) {
      sectionsMap.set(section.id, section);
    }
  }

  return Array.from(sectionsMap.values()).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

