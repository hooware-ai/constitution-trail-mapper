import type { Instruction } from "./types";

/** The bridge emits each leg's distance since the previous instruction, not a cumulative position. */
export function itineraryDistances(instructions: readonly Instruction[]) {
  let fromStart: number | null = 0;
  const valid = (distance: number) =>
    Number.isFinite(distance) && distance >= 0;
  return instructions.map((instruction, index) => {
    fromStart =
      fromStart !== null && valid(instruction.distance)
        ? fromStart + instruction.distance
        : null;
    if (fromStart !== null && !Number.isFinite(fromStart)) fromStart = null;
    const next = instructions[index + 1];
    return {
      fromStart,
      toNext: next && valid(next.distance) ? next.distance : null,
      last: index === instructions.length - 1,
    };
  });
}

export function itineraryDistanceLabel(
  step: ReturnType<typeof itineraryDistances>[number],
) {
  const format = (meters: number) =>
    meters < 160.9344
      ? `${Math.round(meters * 3.28084)} ft`
      : `${(meters / 1609.344).toFixed(1)} mi`;
  const position =
    step.fromStart === null
      ? "Distance from start unavailable"
      : `${format(step.fromStart)} from start`;
  const next = step.last
    ? "Last step"
    : step.toNext === null
      ? "Distance to next step unavailable"
      : `${format(step.toNext)} to next step`;
  return `${position} · ${next}`;
}
