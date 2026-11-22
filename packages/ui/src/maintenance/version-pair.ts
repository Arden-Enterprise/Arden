import type { MaintenanceVersion } from "./maintenance-client";

export type VersionPair = {
  earlierLabel: string;
  laterLabel: string;
  reportedLabel: string | null;
  currentLabel: string | null;
  canPrevious: boolean;
  canNext: boolean;
  canCompareCurrent: boolean;
};

const label = (version: MaintenanceVersion | undefined) => version ? `Version ${version.versionNo}` : null;

export function describeVersionPair(items: MaintenanceVersion[], index: number, reportedVersionId?: string): VersionPair | null {
  const from = items[index];
  const to = items[index + 1];
  if (index < 0 || !from || !to) return null;
  const currentIndex = items.findIndex((version) => version.current);
  return {
    earlierLabel: `Version ${from.versionNo}`,
    laterLabel: `Version ${to.versionNo}`,
    reportedLabel: label(items.find((version) => version.publishedVersionId === reportedVersionId)),
    currentLabel: label(items[currentIndex]),
    canPrevious: index > 0,
    canNext: index < items.length - 2,
    canCompareCurrent: currentIndex > 0 && index !== currentIndex - 1,
  };
}
