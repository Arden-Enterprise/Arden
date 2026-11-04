import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "../shared/Icon";
import type { SettingsSection, SettingsSectionProps } from "./types";
import { getRegisteredSettingsSections, getSettingsRegistryVersion, subscribeSettingsSections } from "./registry";

export type SettingsDialogProps = SettingsSectionProps & {
  open?: boolean;
  initialSectionId?: string;
  extraSections?: SettingsSection[];
};

export function SettingsDialog({
  open = true,
  initialSectionId,
  extraSections,
  onClose,
  ...sectionProps
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const registryVersion = useSyncExternalStore(
    subscribeSettingsSections,
    getSettingsRegistryVersion,
    getSettingsRegistryVersion,
  );

  const sections = useMemo(() => {
    return getRegisteredSettingsSections(extraSections);
  }, [extraSections, registryVersion]);

  const [activeSectionId, setActiveSectionId] = useState<string>(
    initialSectionId ?? sections[0]?.id ?? "account"
  );

  // Keep active section valid if sections list changes
  useEffect(() => {
    if (!sections.some((s) => s.id === activeSectionId) && sections[0]) {
      setActiveSectionId(sections[0].id);
    }
  }, [sections, activeSectionId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const activeSection = sections.find((s) => s.id === activeSectionId) ?? sections[0];
  const ActiveComponent = activeSection?.component;

  const renderIcon = (icon?: IconName | ReactNode) => {
    if (!icon) return null;
    if (typeof icon === "string") {
      return <Icon name={icon as IconName} size={16} />;
    }
    return icon;
  };

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Close if backdrop is clicked directly
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div className="settings-dialog-layout">
        {/* Left Navigation Sidebar */}
        <aside className="settings-sidebar" aria-label="Settings categories">
          <div className="settings-sidebar-header">
            <span className="meta-label">PREFERENCES</span>
            <h2 id={titleId} className="settings-sidebar-title">Settings</h2>
          </div>

          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((section) => {
              const isActive = section.id === activeSection?.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={isActive}
                  className={`settings-nav-item${isActive ? " is-active" : ""}`}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  <span className="settings-nav-icon">{renderIcon(section.icon)}</span>
                  <span className="settings-nav-label">{section.label}</span>
                  {section.badge !== undefined && (
                    <span className="settings-nav-badge">{section.badge}</span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="settings-sidebar-footer">
            <span className="settings-version-label">Arden Workspace</span>
          </div>
        </aside>

        {/* Right Content Area */}
        <section className="settings-content" aria-label={activeSection?.label}>
          <div className="settings-content-header">
            <div className="settings-content-titles">
              <span className="settings-content-crumb">Settings / {activeSection?.label}</span>
            </div>
            <button
              type="button"
              className="settings-close-button"
              onClick={onClose}
              aria-label="Close settings"
              autoFocus
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="settings-content-body">
            {ActiveComponent ? (
              <ActiveComponent
                {...sectionProps}
                onClose={onClose}
              />
            ) : (
              <div className="settings-empty">
                <p>No settings available for this section.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </dialog>
  );
}

