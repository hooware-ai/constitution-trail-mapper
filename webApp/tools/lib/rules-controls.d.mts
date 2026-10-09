export const controls: Array<{
  name: string;
  why: string;
  detects: "tests-fail" | "rules-rejected";
  change: (rules: string) => string;
}>;
