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

export function describeVersionPair(items: MaintenanceVersion[], index: number, reportedVersionId?: string,
  toIndex = index + 1): VersionPair | null {
  const from = items[index];
  const to = items[toIndex];
  if (index < 0 || toIndex <= index || !from || !to) return null;
  const currentIndex = items.findIndex((version) => version.current);
  const reportedIndex = items.findIndex((version) => version.publishedVersionId === reportedVersionId);
  return {
    earlierLabel: `Version ${from.versionNo}`,
    laterLabel: `Version ${to.versionNo}`,
    reportedLabel: label(items[reportedIndex]),
    currentLabel: label(items[currentIndex]),
    canPrevious: index > 0,
    canNext: toIndex < items.length - 1,
    canCompareCurrent: reportedIndex >= 0 && currentIndex > reportedIndex && !(index === reportedIndex && toIndex === currentIndex),
  };
}
