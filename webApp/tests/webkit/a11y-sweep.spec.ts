import { test, expect } from "@playwright/test";
import { SCREENS, sweepScreens } from "../support/a11y-sweep";

test("[engine] no automatically detectable WCAG 2 A/AA violations on any main screen or dialog", async ({
  page,
}) => {
  // Every screen was actually visited and checked, so the sweep cannot quietly shrink.
  expect(await sweepScreens(page)).toEqual(SCREENS);
});
