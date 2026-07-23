// https://github.com/oven-sh/bun/issues/35296
// `Subprocess.kill(signalName)` mapped signal names through a Linux-numbered
// table on every platform, so on macOS "SIGUSR1" (Linux 10) delivered SIGBUS
// (crashing the child with "Bus error at address 0x0"), "SIGUSR2" (Linux 12)
// delivered SIGSYS, "SIGCHLD" (Linux 17) delivered SIGSTOP — and in the other
// direction, a child killed by a real SIGUSR1 (30 on macOS) was reported as
// signalCode "SIGPWR".
//
// These tests are platform-agnostic on purpose: they verify the mapping
// against the OS's own idea of each signal name (bash `trap NAME` / `kill -s
// NAME`), so they hold on Linux and macOS alike and catch any future drift.
import { spawn, spawnSync } from "bun";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

/** Accumulate a subprocess's stdout as text while letting the test poll it. */
function collect(stdout: ReadableStream<Uint8Array>): { readonly text: string; done: Promise<void> } {
  const state = { text: "" };
  const decoder = new TextDecoder();
  const done = (async () => {
    const reader = stdout.getReader();
    try {
      for (;;) {
        const { done: ended, value } = await reader.read();
        if (ended) break;
        state.text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  })();
  return {
    get text() {
      return state.text;
    },
    done,
  };
}

async function until(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(10);
  }
  return true;
}

// Divergent between Linux and Darwin (USR1: 10 vs 30, USR2: 12 vs 31,
// URG: 23 vs 16) plus TERM as a same-number-everywhere control.
const SIGNALS = ["USR1", "USR2", "URG", "TERM"] as const;

test.skipIf(isWindows)("Subprocess.kill(name) delivers the signal the OS knows by that name", async () => {
  for (const name of SIGNALS) {
    const proc = spawn({
      cmd: [
        "/bin/bash",
        "-c",
        // Install the trap, prove it's installed, then wait to be signalled.
        `trap 'echo GOT-${name}; exit 0' ${name}; echo ready; for i in $(seq 1 200); do sleep 0.05; done`,
      ],
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = collect(proc.stdout);
    try {
      expect(await until(() => out.text.includes("ready"), 5_000)).toBe(true);
      proc.kill(`SIG${name}`);
      // On a wrong mapping the trap never fires (or the child dies to an
      // unexpected signal); either way GOT-<name> never arrives.
      const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
      expect(exited).toBe(true);
      await Promise.race([out.done, Bun.sleep(1_000)]);
      const saw = out.text.includes(`GOT-${name}`)
        ? `GOT-${name}`
        : (out.text.replace("ready", "").trim() ?? proc.signalCode);
      expect(`kill("SIG${name}") → ${saw}`).toBe(`kill("SIG${name}") → GOT-${name}`);
    } finally {
      proc.kill(9);
    }
  }
});

test.skipIf(isWindows)("signalCode reports the OS's name for the signal that killed the child", async () => {
  const proc = spawn({ cmd: ["/bin/sleep", "30"] });
  // Deliver a REAL SIGUSR1 using the OS's own name resolver, bypassing Bun.
  spawnSync({ cmd: ["/bin/kill", "-s", "USR1", String(proc.pid)] });
  const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
  try {
    expect(exited).toBe(true);
    expect(proc.signalCode).toBe("SIGUSR1"); // was "SIGPWR" on macOS
  } finally {
    proc.kill(9);
  }
});
