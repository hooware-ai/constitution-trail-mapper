import type { Update } from "./types";
export const updateCategories = [
  "Conditions",
  "Routes",
  "Rules",
  "Maps",
] as const;
export function groupUpdates(updates: Update[]) {
  return [...updateCategories, "Other published notices"]
    .map((label) => ({
      label,
      entries: updates.filter((update) =>
        label === "Other published notices"
          ? !updateCategories.some((category) => category === update.category)
          : update.category === label,
      ),
    }))
    .filter((group) => group.entries.length > 0);
}
