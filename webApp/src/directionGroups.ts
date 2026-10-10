import { isPoint, type Point, type RouteResult } from "./types";

const same = (a: Point | undefined, b: Point | undefined) =>
  !!a && !!b && a.latitude === b.latitude && a.longitude === b.longitude;

/** Label only uniquely proven, contiguous access/trail phases. No distance or text inference. */
export function directionGroupStarts(
  result: RouteResult | null,
): Map<number, string> {
  const none = new Map<number, string>();
  if (
    !result ||
    !Array.isArray(result.segments) ||
    !Array.isArray(result.instructions) ||
    !Array.isArray(result.accessGaps) ||
    result.accessGaps.length ||
    !result.instructions.length
  )
    return none;
  const { segments, instructions } = result;
  if (
    !segments.length ||
    segments.some(
      (s) =>
        !s ||
        !Array.isArray(s.points) ||
        (s.roles !== undefined &&
          (!Array.isArray(s.roles) ||
            s.roles.some((role) => typeof role !== "string"))) ||
        !["Access", "Trail"].includes(s.type) ||
        s.points.length < 2 ||
        !s.points.every(isPoint),
    ) ||
    instructions.some((i) => !i || !isPoint(i.point))
  )
    return none;
  if (
    !same(instructions[0].point, segments[0].points[0]) ||
    !same(instructions.at(-1)?.point, segments.at(-1)?.points.at(-1))
  )
    return none;

  const phases: { index: number; type: string; shared: boolean }[] = [];
  let previous = -1;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (index && segments[index - 1].type === segment.type) {
      phases.at(-1)!.shared ||= !!segment.roles?.includes("SharedRoadways");
      continue;
    }
    let step = 0;
    if (index) {
      const boundary = segment.points[0];
      if (!same(segments[index - 1].points.at(-1), boundary)) return none;
      // Only the joining vertices may share this coordinate. Crossings/revisits are ambiguous.
      const occurrences = segments
        .flatMap((s) => s.points)
        .filter((p) => same(p, boundary)).length;
      const matches = instructions.flatMap((i, n) =>
        same(i.point, boundary) ? [n] : [],
      );
      if (occurrences !== 2 || matches.length !== 1) return none;
      step = matches[0];
      if (step <= previous || step === instructions.length - 1) return none;
    }
    previous = step;
    phases.push({
      index: step,
      type: segment.type,
      shared: !!segment.roles?.includes("SharedRoadways"),
    });
  }
  if (phases.length < 2) return none;
  return new Map(
    phases.map((p) => [
      p.index,
      p.type === "Access"
        ? "Access"
        : p.shared
          ? "Trail and shared roadway"
          : "Trail",
    ]),
  );
}
