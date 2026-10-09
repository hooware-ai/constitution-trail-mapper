// Runs one child invocation and owns its whole process tree: on a timeout, a cancel, or this process exiting, it stops
// only the descendants THIS run started (never a machine-wide sweep) and releases the listeners they hold.
//
// Why a tree: the emulator run is `npx` -> firebase-tools -> Java emulator -> the test process. On Windows the invocation
// goes through `cmd.exe` (shell: true), so `child.kill()` would stop only that shell and leave the rest running (and holding
// the inherited stdout pipes, so the run would not even report its timeout). On POSIX the child is made a process-group
// leader (`detached`) and the group is signalled instead.
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * Stops `child` and every descendant it started. Windows: `taskkill /T /F` on the child's pid (the tree rooted at it,
 * forced, since console processes ignore the polite form). POSIX: the signal goes to the child's own process group.
 */
export function killTree(
  child,
  signal = "SIGTERM",
  platform = process.platform,
) {
  if (!child.pid) return;
  if (platform === "win32") {
    const taskkill = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Runs `invocation` ({ command, args, options }) and resolves with its exit code: the child's own code, 124 when the
 * time limit stopped it, or 130 / 143 when `signal` (an AbortSignal whose reason is "SIGINT" or "SIGTERM") cancelled it.
 * The returned promise always settles shortly after the tree is stopped: polite stop, forced stop after `graceMs`, then
 * the pipes are released even if something somehow still holds them.
 */
export function runOwned(
  invocation,
  {
    cwd,
    timeoutMs,
    say,
    graceMs = 10_000,
    signal,
    platform = process.platform,
  },
) {
  return new Promise((done) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...invocation.options,
      // A process-group leader on POSIX so the whole group can be signalled; Windows uses taskkill /T instead.
      detached: platform !== "win32",
    });
    child.stdout.on("data", (chunk) => say(chunk.toString()));
    child.stderr.on("data", (chunk) => say(chunk.toString()));

    let outcome = null;
    let settled = false;
    const timers = [];
    const finish = (code) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      process.off("exit", onExit);
      signal?.removeEventListener("abort", onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      done(code);
    };
    const stop = (code, message) => {
      if (outcome !== null) return;
      outcome = code;
      say(message);
      killTree(child, "SIGTERM", platform);
      timers.push(
        setTimeout(() => {
          killTree(child, "SIGKILL", platform);
          // Bounded: if something still holds the pipes after the forced stop, report anyway.
          timers.push(setTimeout(() => finish(code), 5_000));
        }, graceMs),
      );
    };
    // A last resort if this process dies abruptly: do not leave the tree behind.
    const onExit = () => {
      if (!settled) killTree(child, "SIGKILL", platform);
    };
    process.on("exit", onExit);

    const onAbort = () => {
      const name = signal.reason === "SIGTERM" ? "SIGTERM" : "SIGINT";
      stop(
        name === "SIGTERM" ? 143 : 130,
        `\nReceived ${name}: stopping the emulator run.\n`,
      );
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    timers.push(
      setTimeout(
        () =>
          stop(
            124,
            `\nTimed out after ${timeoutMs} ms: stopping the emulator run.\n`,
          ),
        timeoutMs,
      ),
    );

    child.on("error", (error) => {
      say(`Could not start: ${error.message}\n`);
      finish(1);
    });
    child.on("close", (code) => finish(outcome ?? code ?? 1));
  });
}
