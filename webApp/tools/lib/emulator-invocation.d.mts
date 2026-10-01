export function normalizePath(
  env: Record<string, string | undefined>,
  platform: string,
  javaHome?: string,
): Record<string, string | undefined>;
export function buildInvocation(args: {
  platform?: string;
  env: Record<string, string | undefined>;
  config: string;
  command: string;
  project: string;
  firebaseTools: string;
}): {
  command: string;
  args: string[];
  options: { shell: boolean; env: Record<string, string | undefined> };
};
