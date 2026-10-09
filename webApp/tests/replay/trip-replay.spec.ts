import { expect, test, type Page } from "@playwright/test";
import {
  fix,
  planPoint,
  setVisible,
  simulateDevice,
  startButton,
} from "../webkit/support";

type MeterPoint = readonly [east: number, north: number];
type Phase = "navigating" | "reacquiring" | "paused" | "lost";
type Step = {
  label: string;
  event: "fix" | "hide" | "show" | "reload" | "loss";
  point?: MeterPoint;
  accuracy?: number;
  ageMs?: number;
  afterMs?: number;
  phase: Phase;
  progress?: readonly [min: number, max: number];
  creditedAtLeast?: number;
};
type Journey = {
  name: string;
  path: readonly MeterPoint[];
  initialProgress: number;
  steps: readonly Step[];
};

const origin = { latitude: 40.5, longitude: -88.95 };
function coordinate([east, north]: MeterPoint) {
  return {
    latitude: origin.latitude + north / 111_195,
    longitude:
      origin.longitude +
      east / (111_195 * Math.cos((origin.latitude * Math.PI) / 180)),
  };
}

async function seedRide(
  page: Page,
  path: readonly MeterPoint[],
  progress: number,
) {
  await page.addInitScript(
    ({ path, progress }) => {
      const key = "trail-mapper.fixture:trail-mapper.web.active-ride.v1";
      if (localStorage.getItem(key)) return;
      const at = ([east, north]: [number, number]) => ({
        latitude: 40.5 + north / 111_195,
        longitude: -88.95 + east / (111_195 * Math.cos((40.5 * Math.PI) / 180)),
      });
      const points = path.map(at);
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          record: {
            key: "replay-loop",
            title: "Synthetic replay loop",
            createdAt: Date.now(),
            usedAt: Date.now(),
            route: {
              segments: points.slice(1).map((end, index) => ({
                type: "Trail",
                points: [points[index], end],
                isRouted: true,
              })),
              totalDistanceMeters: 4000,
              ordinaryAccessDistanceMeters: 0,
              totalCost: 1,
              kind: "ExerciseLoop",
            },
            draft: {
              mode: "loop",
              start: { label: "Synthetic trailhead", ...points[0] },
              destination: null,
              miles: 3,
              proposed: false,
            },
          },
          routeProgressMeters: progress,
          creditedDistanceMeters: 2000,
          updatedAt: Date.now(),
        }),
      );
    },
    {
      path: path.map(([east, north]) => [east, north] as [number, number]),
      progress,
    },
  );
}

async function rideState(page: Page): Promise<{
  routeProgressMeters: number;
  creditedDistanceMeters: number;
  updatedAt: number;
}> {
  return page.evaluate(() => {
    const raw = localStorage.getItem(
      "trail-mapper.fixture:trail-mapper.web.active-ride.v1",
    );
    if (!raw) throw new Error("The synthetic replay ride was not retained");
    return JSON.parse(raw);
  });
}

async function acceptedFix(page: Page, latitude: number, longitude: number) {
  // A frozen clock otherwise lets a saved record from the preceding fix pass.
  await page.clock.fastForward(1);
  const at = await page.evaluate(() => Date.now());
  await fix(page, latitude, longitude);
  await expect
    .poll(async () => (await rideState(page)).updatedAt)
    .toBeGreaterThanOrEqual(at);
}

async function expectPhase(page: Page, phase: Phase) {
  if (phase === "navigating") {
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    return;
  }
  const title = {
    reacquiring: /^Reacquiring location(?:\.|…)$/,
    paused: "Navigation paused",
    lost: "Location lost",
  }[phase];
  await expect(page.locator(".ride-guidance h2")).toHaveText(title);
  await expect(page.locator(".ride-guidance")).toBeVisible();
  await expect(page.locator(".guidance.navigating")).not.toBeVisible();
}

async function replayStep(page: Page, step: Step) {
  await test.step(step.label, async () => {
    if (step.afterMs) await page.clock.fastForward(step.afterMs);
    switch (step.event) {
      case "fix": {
        if (!step.point) throw new Error("A fix needs a point");
        const place = coordinate(step.point);
        if ((step.accuracy ?? 5) <= 5 && (step.ageMs ?? 0) === 0)
          await acceptedFix(page, place.latitude, place.longitude);
        else
          await fix(
            page,
            place.latitude,
            place.longitude,
            step.accuracy ?? 5,
            step.ageMs ?? 0,
          );
        break;
      }
      case "hide":
        await setVisible(page, false);
        break;
      case "show":
        await setVisible(page, true);
        break;
      case "reload":
        await page.reload();
        break;
      case "loss":
        await page.evaluate(() => (window as any).__device.fail(2));
        break;
    }
    await expectPhase(page, step.phase);
    if (step.progress) {
      await expect
        .poll(async () => {
          const value = (await rideState(page)).routeProgressMeters;
          return value > step.progress![0] && value < step.progress![1];
        })
        .toBe(true);
    }
    if (step.creditedAtLeast !== undefined)
      await expect
        .poll(async () => (await rideState(page)).creditedDistanceMeters)
        .toBeGreaterThan(step.creditedAtLeast);
  });
}

const square: MeterPoint[] = [
  [0, 0],
  [0, 1000],
  [1000, 1000],
  [1000, 0],
  [0, 0],
];
const outAndBack: MeterPoint[] = [
  [0, 0],
  [0, 1000],
  [0, 2000],
  [0, 1000],
  [0, 0],
];

const journeys: Journey[] = [
  {
    name: "corner turns advance observed distance and route progress",
    path: square,
    initialProgress: 1000,
    steps: [
      {
        label: "acquire the corner",
        event: "fix",
        point: [0, 1000],
        phase: "navigating",
        progress: [990, 1010],
      },
      {
        label: "ride 20 m east",
        event: "fix",
        point: [20, 1000],
        afterMs: 5000,
        phase: "navigating",
        progress: [1012, 1028],
        creditedAtLeast: 2012,
      },
      {
        label: "ride another 20 m east",
        event: "fix",
        point: [40, 1000],
        afterMs: 5000,
        phase: "navigating",
        progress: [1032, 1048],
        creditedAtLeast: 2032,
      },
    ],
  },
  {
    name: "the repeated return leg never rewinds to the outbound pass",
    path: outAndBack,
    initialProgress: 3000,
    steps: [
      {
        label: "resume on the return pass",
        event: "fix",
        point: [0, 900],
        phase: "navigating",
        progress: [3000, 3200],
      },
      {
        label: "reload requires a fresh location",
        event: "reload",
        phase: "reacquiring",
      },
      {
        label: "continue toward the start on the return pass",
        event: "fix",
        point: [0, 800],
        phase: "navigating",
        progress: [3175, 3225],
      },
    ],
  },
  {
    name: "coarse and lost fixes pause guidance; visibility and reload reacquire",
    path: square,
    initialProgress: 1000,
    steps: [
      {
        label: "accept a precise fix",
        event: "fix",
        point: [0, 1000],
        phase: "navigating",
      },
      {
        label: "reject a coarse fix",
        event: "fix",
        point: [0, 1000],
        accuracy: 150,
        phase: "lost",
      },
      {
        label: "recover from the coarse fix",
        event: "fix",
        point: [0, 1000],
        phase: "navigating",
      },
      { label: "report provider loss", event: "loss", phase: "lost" },
      {
        label: "recover from provider loss",
        event: "fix",
        point: [0, 1000],
        phase: "navigating",
      },
      { label: "hide the page", event: "hide", phase: "paused" },
      { label: "show the page", event: "show", phase: "reacquiring" },
      {
        label: "reacquire after return",
        event: "fix",
        point: [0, 1000],
        phase: "navigating",
      },
      { label: "reload the ride", event: "reload", phase: "reacquiring" },
      {
        label: "reacquire after reload",
        event: "fix",
        point: [0, 1000],
        phase: "navigating",
      },
    ],
  },
];

test.beforeEach(async ({ page, context }) => {
  await context.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => route.abort(),
  );
  await page.clock.install();
  await simulateDevice(page);
});

for (const journey of journeys)
  test(`[simulated trip] ${journey.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seedRide(page, journey.path, journey.initialProgress);
    await page.goto("/");
    await expectPhase(page, "reacquiring");
    for (const step of journey.steps) await replayStep(page, step);
    expect(errors).toEqual([]);
  });

test("[simulated trip] sustained departure needs confirmation, then a mapped reroute and fresh fix", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await planPoint(page);
  await expect(startButton(page)).toBeEnabled();
  await startButton(page).click();
  await expectPhase(page, "reacquiring");
  await acceptedFix(page, 40.51, -88.95);
  await expectPhase(page, "navigating");
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.509, -88.96);
  await expect(
    page.getByText("Checking whether you are off route…"),
  ).toBeVisible();
  for (const [lat, lon] of [
    [40.5085, -88.96],
    [40.508, -88.96],
  ] as const) {
    await page.clock.fastForward(8000);
    await acceptedFix(page, lat, lon);
  }
  await expect(
    page.getByRole("heading", { name: "You are off route", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reroute", exact: true }).click();
  await expect(
    page.getByText(
      /^Route updated from here: [\d.]+ mi to your destination\.$/,
    ),
  ).toBeVisible();
  await expectPhase(page, "reacquiring");
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.508, -88.96);
  await expectPhase(page, "navigating");
  expect(errors).toEqual([]);
});
