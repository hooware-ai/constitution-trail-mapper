export const FIREBASE_TOOLS: string;
export const PROJECT_ID: string;
type Env = Record<string, string | undefined>;
export function withoutCredentials(env: Env): Env;
export function normalizePath(
  env: Env,
  platform: string,
  javaHome?: string,
): Env;
export function buildInvocation(args: {
  platform?: string;
  env: Env;
  config: string;
  command: string;
  project?: string;
  firebaseTools?: string;
}): {
  command: string;
  args: string[];
  options: { shell: boolean; env: Env };
};
export function buildPrefetchInvocation(args: {
  platform?: string;
  env: Env;
  firebaseTools?: string;
}): {
  command: string;
  args: string[];
  options: { shell: boolean; env: Env };
};
