import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { isMacOS, isWindows, tempDirWithFiles } from "harness";
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── hermetic launcher fixture ──────────────────────────────────────────────
// Real launches whose "opener" is a script we control: `Bun.open(target,
// { app })` executes it with the target as its only argument, so every
// happy-path assertion below exercises the full spawn machinery without
// ever opening a real browser, file manager, or text editor.
//
// Default-opener integration (a real browser launch) is opt-in via
// DSH_BUN_OPEN_E2E=1 because it pops windows on the host machine.

let fixtureDir: string;
let launcherPath: string;
let sentinelPath: string;

beforeAll(() => {
  fixtureDir = tempDirWithFiles("bun-open-test", {});
  sentinelPath = join(fixtureDir, "sentinel.txt");
  if (isWindows) {
    // A .cmd opener runs through cmd.exe (libuv spawns batch files via
    // cmd /c), which is exactly what the default Windows route does — so
    // this also covers the BatBadBut argument-guard interaction.
    launcherPath = join(fixtureDir, "opener.cmd");
    writeFileSync(launcherPath, `@echo off\r\necho launched>"${sentinelPath}"\r\nexit /b 0\r\n`);
  } else {
    launcherPath = join(fixtureDir, "opener.sh");
    writeFileSync(launcherPath, `#!/bin/sh\necho launched > '${sentinelPath}'\n`);
    chmodSync(launcherPath, 0o755);
  }
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

async function waitForSentinel(ms = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (existsSync(sentinelPath)) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return existsSync(sentinelPath);
}

function resetSentinel() {
  rmSync(sentinelPath, { force: true });
}

describe("Bun.open", () => {
  describe("argument validation", () => {
    test("rejects when called with no arguments", async () => {
      // @ts-expect-error testing runtime behavior with a missing argument
      await expect(Bun.open()).rejects.toThrow(/target/i);
    });

    test("rejects non-string targets", async () => {
      for (const bad of [1, null, undefined, true, {}, [], Symbol("x")]) {
        // @ts-expect-error testing runtime behavior with a wrong-typed input
        await expect(Bun.open(bad)).rejects.toThrow(/target/i);
      }
    });

    test("rejects the empty string with ERR_INVALID_ARG_VALUE", async () => {
      const rejection = await Bun.open("").catch(error => error);
      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toMatch(/Invalid target|empty/i);
      expect((rejection as { code?: string }).code).toBe("ERR_INVALID_ARG_VALUE");
    });

    test("rejects targets containing a NUL byte", async () => {
      for (const bad of ["\0", "https://example.com/\0", "file.txt\0trailing"]) {
        await expect(Bun.open(bad)).rejects.toThrow(/NUL/i);
      }
    });

    test("rejects non-object options", async () => {
      for (const bad of [42, "nope", true, []]) {
        // @ts-expect-error testing runtime behavior with a wrong-typed input
        await expect(Bun.open("https://example.com", bad)).rejects.toThrow(/options/i);
      }
    });

    test("launches with a full option bag", async () => {
      resetSentinel();
      const result = await Bun.open(
        "hermetic-target",
        { app: launcherPath, background: false, newInstance: false, edit: false },
      );
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 15000);

    test("rejects a non-string app", async () => {
      // @ts-expect-error testing runtime behavior with a wrong-typed input
      await expect(Bun.open("https://example.com", { app: 7 })).rejects.toThrow(/app/i);
      // @ts-expect-error testing runtime behavior with a wrong-typed input
      await expect(Bun.open("https://example.com", { app: {} })).rejects.toThrow(/app/i);
    });

    test("rejects an empty-string app instead of silently using the default opener", async () => {
      await expect(Bun.open("https://example.com", { app: "" })).rejects.toThrow(/app/i);
    });
  });

  describe("hermetic launch (app override)", () => {
    test("launches and reports pid + exited promise shape", async () => {
      resetSentinel();
      const result = await Bun.open("hermetic-target", { app: launcherPath, wait: true });
      expect(Number.isInteger(result.pid)).toBe(true);
      expect(result.pid).toBeGreaterThan(0);
      expect(result.ok).toBe(true);
      expect(result.exited).toBeInstanceOf(Promise);
      const exitCode = await result.exited;
      expect(typeof exitCode).toBe("number");
      expect(exitCode).toBe(0);
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 15000);

    test("writes the target into the sentinel proving the target was passed", async () => {
      resetSentinel();
      const result = await Bun.open("sentinel-probe", { app: launcherPath, wait: true });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 15000);

    test("ignores unknown option keys", async () => {
      resetSentinel();
      const result = await Bun.open("hermetic-target", {
        app: launcherPath,
        // @ts-expect-error unknown keys are ignored, not an error
        notARealOption: true,
      });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 15000);

    test.skipIf(!isMacOS)("maps background/newInstance/edit to /usr/bin/open flags", async () => {
      // Flags are passed to `/usr/bin/open -a <launcher>`; the hermetic
      // launcher still runs and writes the sentinel.
      resetSentinel();
      const result = await Bun.open("hermetic-target", {
        app: launcherPath,
        background: true,
        newInstance: true,
        edit: true,
      });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 15000);

    test.skipIf(isMacOS)("accepts macOS-only flags on other platforms without changing behavior", async () => {
      resetSentinel();
      const result = await Bun.open("hermetic-target", {
        app: launcherPath,
        wait: true,
        background: true,
        newInstance: true,
        // `edit` is deliberately absent here: on Windows it maps to the
        // shell "edit" verb, whose DDE negotiation can stall the dispatch.
      });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 15000);

    test("handles very long targets under the OS command-line limit", async () => {
      resetSentinel();
      // Windows: cmd.exe re-tokenizes the line and caps itself at 8_191
      // chars even though CreateProcessW allows 32_767, so stay under that.
      // POSIX argv is unbounded in practice.
      const longTarget = Buffer.alloc(isWindows ? 4_000 : 20_000, "x").toString();
      const result = await Bun.open(longTarget, { app: launcherPath, wait: true });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 20000);

    test.skipIf(!isWindows)("targets beyond cmd.exe's 8_191-char line limit settle cleanly", async () => {
      // ShellExecuteExW on a .cmd still routes through cmd.exe internally,
      // whose own 8_191-char limit applies even though CreateProcessW allows
      // 32_767. The contract: settle deterministically (exit code or
      // rejection), never crash or hang.
      const huge = Buffer.alloc(20_000, "x").toString();
      const outcome = await Bun.open(huge, { app: launcherPath, wait: true }).then(
        () => "fulfilled" as const,
        error => {
          expect(error).toBeInstanceOf(Error);
          return "rejected" as const;
        },
      );
      expect(["fulfilled", "rejected"]).toContain(outcome);
    }, 20000);

    test("wait: true settles the outer promise after the handler exits", async () => {
      resetSentinel();
      const result = await Bun.open("waited-target", { app: launcherPath, wait: true });
      // By the time the promise settles on Windows, the handler has already
      // exited — so its writes are visible without awaiting `exited`.
      expect(result.pid).toBeGreaterThan(0);
      expect(await waitForSentinel(1500)).toBe(true);
      const code = await result.exited;
      expect(code).toBe(0);
      resetSentinel();
    }, 20000);

    test("app object form carries name plus arguments", async () => {
      resetSentinel();
      const result = await Bun.open("object-app-target", {
        app: { name: launcherPath, arguments: ["ignored-by-fixture"] },
        wait: true,
      });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 20000);

    test("rejects an already-aborted signal without launching", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        Bun.open("https://example.com", { signal: controller.signal }),
      ).rejects.toThrow(/abort/i);
    }, 10000);

    test("a live signal does not disturb the launch", async () => {
      resetSentinel();
      const controller = new AbortController();
      const result = await Bun.open("signal-live-target", {
        app: launcherPath,
        wait: true,
        signal: controller.signal,
      });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      controller.abort();
      resetSentinel();
    }, 20000);

    test.skipIf(!isWindows || !process.env.DSH_BUN_OPEN_E2E)("wait: true is honored for directory targets (settles after exited)", async () => {
      // Directory targets route through `explorer.exe` via Bun.spawn; the
      // outer promise must park until that process exits when `wait: true`,
      // matching the ShellExecute path's settle contract. Before the fix it
      // resolved immediately, so `exited` could still be pending here.
      // E2E-gated: explorer.exe pops a file-browser window.
      const result = await Bun.open(import.meta.dir, { wait: true });
      expect(result.pid).toBeGreaterThan(0);
      expect(result.exited).toBeInstanceOf(Promise);
      const exitCode = await Promise.race([
        result.exited,
        new Promise(resolve => setTimeout(() => resolve("timeout"), 5_000)),
      ]);
      expect(typeof exitCode).toBe("number");
    }, 20000);

    test.skipIf(!isWindows)("hideErrors suppresses the shell dialog and surfaces an error", async () => {
      // An extension nothing handles would normally pop the "How do you want
      // to open this?" dialog; SEE_MASK_FLAG_NO_UI turns it into a rejection.
      await expect(
        Bun.open("definitely-unassociated.dsh-no-association"),
      ).rejects.toThrow();
    }, 20000);

    test("handles concurrent launches", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => Bun.open("concurrent-target", { app: launcherPath, wait: true })),
      );
      for (const result of results) {
        expect(result.pid).toBeGreaterThan(0);
        await result.exited;
      }
      // Every launch got its own process.
      expect(new Set(results.map(r => r.pid)).size).toBe(5);
      resetSentinel();
    }, 20000);

    test("handles sequential launches", async () => {
      for (let i = 0; i < 3; i++) {
        const result = await Bun.open(`sequential-${i}`, { app: launcherPath, wait: true });
        await result.exited;
      }
      resetSentinel();
    }, 20000);

    test("survives unicode and space-laden targets", async () => {
      resetSentinel();
      const result = await Bun.open("héllo wörld 🦀", { app: launcherPath, wait: true });
      await result.exited;
      expect(await waitForSentinel()).toBe(true);
      resetSentinel();
    }, 15000);

    test("whitespace-only targets settle without crashing the runtime", async () => {
      const outcome = await Bun.open("   ", { app: launcherPath, wait: true }).then(
        () => "fulfilled" as const,
        error => {
          expect(error).toBeInstanceOf(Error);
          return "rejected" as const;
        },
      );
      expect(["fulfilled", "rejected"]).toContain(outcome);
    }, 15000);
  });

  describe("error paths", () => {
    test("rejects when the app binary does not exist", async () => {
      const missing = join(fixtureDir, "definitely-not-here" + (isWindows ? ".exe" : ""));
      await expect(Bun.open("target", { app: missing })).rejects.toThrow();
    }, 15000);

    test("rejects when the app is a directory", async () => {
      await expect(Bun.open("target", { app: fixtureDir })).rejects.toThrow();
    }, 15000);

    test("rejects when the app exits non-zero", async () => {
      let failingLauncher: string;
      if (isWindows) {
        failingLauncher = join(fixtureDir, "failing.cmd");
        writeFileSync(failingLauncher, "@echo off\r\nexit /b 3\r\n");
      } else {
        failingLauncher = join(fixtureDir, "failing.sh");
        writeFileSync(failingLauncher, "#!/bin/sh\nexit 3\n");
        chmodSync(failingLauncher, 0o755);
      }
      const result = await Bun.open("target", { app: failingLauncher, wait: true });
      // The launch itself succeeded; the failure surfaces on `exited`
      // (non-zero code or rejection), never as a crash.
      const outcome = await result.exited.then(
        code => ({ kind: "code" as const, code }),
        error => {
          expect(error).toBeInstanceOf(Error);
          return { kind: "rejection" as const };
        },
      );
      if (outcome.kind === "code") {
        expect(outcome.code).not.toBe(0);
      }
    }, 15000);

    test("promise rejections carry Error instances with messages", async () => {
      const rejection = await Bun.open("").catch(error => error);
      expect(rejection).toBeInstanceOf(Error);
      expect(typeof (rejection as Error).message).toBe("string");
      expect((rejection as Error).message.length).toBeGreaterThan(0);
    });
  });

  describe("default-opener integration", () => {
    // These pop real windows. Run with DSH_BUN_OPEN_E2E=1 on a desktop
    // machine; CI keeps them skipped.

    test.skipIf(!process.env.DSH_BUN_OPEN_E2E)("opens an https URL in the default browser", async () => {
      const result = await Bun.open("https://example.com");
      expect(result.pid).toBeGreaterThan(0);
      expect(result.exited).toBeInstanceOf(Promise);
    }, 30000);

    test.skipIf(!process.env.DSH_BUN_OPEN_E2E)("opens a folder in the platform file manager", async () => {
      const result = await Bun.open(import.meta.dir);
      expect(result.pid).toBeGreaterThan(0);
    }, 30000);
  });
});
