import type { ChildProcess, SpawnOptions } from "node:child_process";

export function killTree(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal?: NodeJS.Signals,
  platform?: NodeJS.Platform,
): void;

export function runOwned(
  invocation: { command: string; args: string[]; options?: SpawnOptions },
  options: {
    cwd?: string;
    timeoutMs: number;
    say: (text: string) => void;
    graceMs?: number;
    signal?: AbortSignal;
    platform?: NodeJS.Platform;
  },
): Promise<number>;
