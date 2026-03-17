import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { basename } from "node:path";

const crontabPath = Bun.which("crontab");
const hasCrontab = !!crontabPath && isLinux;
const hasSchtasks =
  isWindows &&
  (() => {
    try {
      // Test the XML-based path that Bun.cron actually uses.
      // Only returns true if the current user's SID can be resolved.
      const xml = [
        '<?xml version="1.0"?>',
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
        "  <Triggers><CalendarTrigger>",
        "    <StartBoundary>2000-01-01T00:00:00</StartBoundary>",
        "    <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>",
        "  </CalendarTrigger></Triggers>",
        "  <Settings><Enabled>true</Enabled></Settings>",
        "  <Actions><Exec><Command>cmd</Command><Arguments>/c echo probe</Arguments></Exec></Actions>",
        "</Task>",
      ].join("\n");
      const xmlPath = `${process.env.TEMP || "C:\\Temp"}\\bun-cron-probe.xml`;
      writeFileSync(xmlPath, xml);
      try {
        const r = Bun.spawnSync({
          cmd: ["schtasks", "/create", "/xml", xmlPath, "/tn", "bun-cron-probe", "/np", "/f"],
          stdout: "pipe",
          stderr: "pipe",
        });
        if (r.exitCode !== 0) return false;
        Bun.spawnSync({
          cmd: ["schtasks", "/delete", "/tn", "bun-cron-probe", "/f"],
          stdout: "ignore",
          stderr: "ignore",
        });
        return true;
      } finally {
        try {
          unlinkSync(xmlPath);
        } catch {}
      }
    } catch {
      return false;
    }
  })();
const hasLaunchctl =
  isMacOS &&
  (() => {
    try {
      const r = Bun.spawnSync({
        cmd: ["launchctl", "print", "gui/" + String(process.getuid())],
        stdout: "pipe",
        stderr: "pipe",
      });
      return r.exitCode === 0;
    } catch {
      return false;
    }
  })();
const hasAnyCronBackend = hasCrontab || hasLaunchctl || hasSchtasks;

function readCrontab(): string {
  const result = Bun.spawnSync({
    cmd: [crontabPath!, "-l"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0 ? result.stdout.toString() : "";
}

function writeCrontab(content: string) {
  const tmpFile = `/tmp/bun-cron-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmpFile, content);
  try {
    Bun.spawnSync({ cmd: [crontabPath!, tmpFile] });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

function saveCrontabState(): Disposable {
  const saved = readCrontab();
  return {
    [Symbol.dispose]() {
      writeCrontab(saved);
    },
  };
}

// ==========================================================================
// API shape
// ==========================================================================

describe("Bun.cron API", () => {
  test("is a function", () => {
    expect(typeof Bun.cron).toBe("function");
  });

  test("has .remove method", () => {
    expect(typeof Bun.cron.remove).toBe("function");
  });

  test("has .parse method", () => {
    expect(typeof Bun.cron.parse).toBe("function");
  });

  test("throws with no arguments", () => {
    // @ts-ignore
    expect(() => Bun.cron()).toThrow();
  });

  test("throws with non-string path", () => {
    // @ts-ignore
    expect(() => Bun.cron(123, "* * * * *", "test-bad")).toThrow();
  });

  test("throws with non-string schedule", () => {
    // @ts-ignore
    expect(() => Bun.cron("./test.ts", 123, "test-bad")).toThrow();
  });

  test("throws with non-string title", () => {
    // @ts-ignore
    expect(() => Bun.cron("./test.ts", "* * * * *", 123)).toThrow();
  });

  test("remove throws with non-string title", () => {
    // @ts-ignore
    expect(() => Bun.cron.remove(123)).toThrow();
  });

  test("throws with invalid title characters", () => {
    expect(() => Bun.cron("./test.ts", "* * * * *", "bad title!")).toThrow(/alphanumeric/);
    expect(() => Bun.cron("./test.ts", "* * * * *", "bad/title")).toThrow(/alphanumeric/);
    expect(() => Bun.cron("./test.ts", "* * * * *", "")).toThrow(/alphanumeric/);
  });

  test("throws with invalid cron expression", () => {
    expect(() => Bun.cron("./test.ts", "not a cron", "test-bad")).toThrow(/cron expression/i);
    expect(() => Bun.cron("./test.ts", "* * *", "test-bad")).toThrow(/cron expression/i);
    expect(() => Bun.cron("./test.ts", "* * * * * *", "test-bad")).toThrow(/cron expression/i);
    expect(() => Bun.cron("./test.ts", "abc * * * *", "test-bad")).toThrow(/cron expression/i);
  });

  test("throws with percent sign in path", async () => {
    using dir = tempDir("bun-cron-test", {
      "test%file.ts": `export default { scheduled() {} };`,
    });
    expect(() => Bun.cron(`${dir}/test%file.ts`, "* * * * *", "test-bad")).toThrow(/percent/i);
  });

  test("remove throws with invalid title characters", () => {
    expect(() => Bun.cron.remove("bad title!")).toThrow(/alphanumeric/);
  });
});

// ==========================================================================
// Cross-platform API consistency
// ==========================================================================

describe.skipIf(!hasAnyCronBackend)("cross-platform API consistency", () => {
  test("@daily nickname registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    // @daily normalizes to "0 0 * * *" which all platforms support
    const result = await Bun.cron(`${dir}/job.ts`, "@daily", "test-xplat-daily");
    expect(result).toBeUndefined();
    // Clean up
    await Bun.cron.remove("test-xplat-daily");
  });

  test("@weekly nickname registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    const result = await Bun.cron(`${dir}/job.ts`, "@weekly", "test-xplat-weekly");
    expect(result).toBeUndefined();
    await Bun.cron.remove("test-xplat-weekly");
  });

  test("@hourly nickname registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    const result = await Bun.cron(`${dir}/job.ts`, "@hourly", "test-xplat-hourly");
    expect(result).toBeUndefined();
    await Bun.cron.remove("test-xplat-hourly");
  });

  test("every-5-minutes registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    const result = await Bun.cron(`${dir}/job.ts`, "*/5 * * * *", "test-xplat-5min");
    expect(result).toBeUndefined();
    await Bun.cron.remove("test-xplat-5min");
  });

  test("named weekday (Monday) normalizes and registers", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    const result = await Bun.cron(`${dir}/job.ts`, "30 9 * * Monday", "test-xplat-named");
    expect(result).toBeUndefined();
    await Bun.cron.remove("test-xplat-named");
  });

  test("path with spaces works", async () => {
    using dir = tempDir("bun cron spaces test", {
      "my job.ts": `export default { scheduled() {} };`,
    });
    const result = await Bun.cron(`${dir}/my job.ts`, "0 0 * * *", "test-xplat-spaces");
    expect(result).toBeUndefined();
    await Bun.cron.remove("test-xplat-spaces");
  });

  test("relative path resolves relative to caller file, not cwd (docs L139)", async () => {
    // Create register.ts + worker.ts in a temp dir; register.ts uses "./worker.ts".
    // Run register.ts from a DIFFERENT cwd and verify the resolved absolute path
    // points into the temp dir (caller's directory), not into cwd.
    using dir = tempDir("bun-cron-caller-rel", {
      "worker.ts": `export default { scheduled() {} };`,
      "register.ts": `
        await Bun.cron("./worker.ts", "0 0 * * *", "test-xplat-caller-rel");
        console.log("registered");
      `,
    });
    // Make an unrelated cwd — must not contain worker.ts
    using cwdDir = tempDir("bun-cron-other-cwd", {});

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), `${dir}/register.ts`],
        env: bunEnv,
        cwd: String(cwdDir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("registered");
      expect(exitCode).toBe(0);

      // Verify the registered path points at worker.ts inside the temp dir.
      // Each backend records the absolute path differently; inspect the appropriate one.
      if (hasLaunchctl) {
        const plist = await Bun.file(
          `${process.env.HOME}/Library/LaunchAgents/bun.cron.test-xplat-caller-rel.plist`,
        ).text();
        // On macOS /tmp is a symlink to /private/tmp, so the resolved path may use either.
        // The important thing: it ends in the caller dir's worker.ts, not the cwd.
        expect(plist).toMatch(/bun-cron-caller-rel[^<]*[\\/]worker\.ts/);
        expect(plist).not.toContain("bun-cron-other-cwd");
      } else if (hasCrontab) {
        const crontab = Bun.spawnSync({ cmd: [Bun.which("crontab")!, "-l"], stdout: "pipe" }).stdout.toString();
        expect(crontab).toMatch(/bun-cron-caller-rel[^\n]*[\\/]worker\.ts/);
        expect(crontab).not.toContain("bun-cron-other-cwd");
      } else if (hasSchtasks) {
        const query = Bun.spawnSync({
          cmd: ["schtasks", "/query", "/tn", "bun-cron-test-xplat-caller-rel", "/xml"],
          stdout: "pipe",
        }).stdout.toString();
        expect(query).toMatch(/bun-cron-caller-rel[^<]*[\\/]worker\.ts/);
        expect(query).not.toContain("bun-cron-other-cwd");
      }
    } finally {
      await Bun.cron.remove("test-xplat-caller-rel");
    }
  });

  test("remove resolves undefined on success", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-xplat-rm-val");
    const result = await Bun.cron.remove("test-xplat-rm-val");
    expect(result).toBeUndefined();
  });

  test("remove non-existent job resolves without error", async () => {
    const result = await Bun.cron.remove("test-xplat-nonexistent-12345");
    expect(result).toBeUndefined();
  });
});

// Windows uses XML-based task registration with CalendarTrigger,
// supporting the full range of cron expressions including monthly,
// yearly, ranges, lists, and day-of-month patterns.
describe.skipIf(!hasSchtasks)("Windows XML-based scheduling (complex expressions)", () => {
  test("@monthly registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      const result = await Bun.cron(`${dir}/job.ts`, "@monthly", "test-win-monthly");
      expect(result).toBeUndefined();
      expect(querySchtask("test-win-monthly")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-monthly");
    }
  });

  test("@yearly registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      const result = await Bun.cron(`${dir}/job.ts`, "@yearly", "test-win-yearly");
      expect(result).toBeUndefined();
      expect(querySchtask("test-win-yearly")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-yearly");
    }
  });

  test("complex range expression registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      const result = await Bun.cron(`${dir}/job.ts`, "*/15 1-5 1,15 * 0-4", "test-win-complex");
      expect(result).toBeUndefined();
      expect(querySchtask("test-win-complex")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-complex");
    }
  });

  test("day-of-month expression registers successfully", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      const result = await Bun.cron(`${dir}/job.ts`, "0 0 15 * *", "test-win-dom");
      expect(result).toBeUndefined();
      expect(querySchtask("test-win-dom")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-dom");
    }
  });
});

// Test all Windows XML code paths: ScheduleByMonth, ScheduleByWeek,
// ScheduleByMonthDayOfWeek, Repetition, and OR-split (day-of-month + day-of-week).
describe.skipIf(!hasSchtasks)("Windows XML code paths", () => {
  test("ScheduleByMonthDayOfWeek: weekday with month restriction", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // Every Monday in June — uses ScheduleByMonthDayOfWeek
      await Bun.cron(`${dir}/job.ts`, "0 9 * 6 1", "test-win-monthdow");
      expect(querySchtask("test-win-monthdow")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-monthdow");
    }
  });

  test("OR-split: day-of-month AND day-of-week produce two triggers", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // 15th of month OR every Friday — should create two triggers
      await Bun.cron(`${dir}/job.ts`, "0 0 15 * 5", "test-win-or-split");
      expect(querySchtask("test-win-or-split")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-or-split");
    }
  });

  test("daily with month restriction", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // Every day in June — uses ScheduleByMonth with all 31 days
      await Bun.cron(`${dir}/job.ts`, "0 0 * 6 *", "test-win-daily-month");
      expect(querySchtask("test-win-daily-month")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-daily-month");
    }
  });

  test("hourly repetition pattern", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // Every 3 hours — uses Repetition PT3H
      await Bun.cron(`${dir}/job.ts`, "0 */3 * * *", "test-win-hourly-rep");
      expect(querySchtask("test-win-hourly-rep")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-hourly-rep");
    }
  });
});

// Windows Task Scheduler has a limit of 48 CalendarTrigger elements per task.
// Complex cron expressions that expand to more than 48 (hour, minute) pairs fail
// on Windows but work fine on Linux (crontab) and macOS (launchd CalendarInterval).
// https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page
//
// These tests verify:
//   - On Windows: Bun.cron() rejects these patterns with an error about triggers
//   - On non-Windows: Bun.cron() registers them successfully
describe.skipIf(!hasAnyCronBackend)("Windows trigger-limit expressions", () => {
  // Category 1: Minute steps that don't evenly divide 60.
  // e.g. */7 = 9 minute values × 24 hours = 216 triggers (limit: 48)
  // Divisors of 60 (1,2,3,4,5,6,10,12,15,20,30) use Repetition and are fine.
  const nonDivisorSteps = [
    { expr: "*/7 * * * *", title: "step-7min", triggers: "9×24=216" },
    { expr: "*/8 * * * *", title: "step-8min", triggers: "8×24=192" },
    { expr: "*/9 * * * *", title: "step-9min", triggers: "7×24=168" },
    { expr: "*/11 * * * *", title: "step-11min", triggers: "6×24=144" },
    { expr: "*/13 * * * *", title: "step-13min", triggers: "5×24=120" },
  ];

  for (const { expr, title, triggers } of nonDivisorSteps) {
    if (isWindows) {
      test(`${expr} throws on Windows (${triggers} triggers > 48)`, () => {
        using dir = tempDir("bun-cron-test", {
          "job.ts": `export default { scheduled() {} };`,
        });
        expect(() => Bun.cron(`${dir}/job.ts`, expr, `test-win-${title}`)).toThrow(/too many triggers/i);
      });
    } else {
      test(`${expr} succeeds on ${isMacOS ? "macOS" : "Linux"}`, async () => {
        using dir = tempDir("bun-cron-test", {
          "job.ts": `export default { scheduled() {} };`,
        });
        const t = `test-win-${title}`;
        try {
          const result = await Bun.cron(`${dir}/job.ts`, expr, t);
          expect(result).toBeUndefined();
        } finally {
          await Bun.cron.remove(t);
        }
      });
    }
  }

  // Category 2: Frequent intervals with restricted fields prevent Repetition.
  // */15 with all hours and wildcard days uses Repetition (1 trigger),
  // but adding a month or weekday restriction forces per-pair expansion.
  const restrictedFieldExprs = [
    {
      expr: "*/15 * * 6 *",
      title: "step15-month",
      why: "4 minutes × 24 hours = 96 triggers (month restriction prevents Repetition)",
    },
    {
      expr: "0,10,20,30,40,50 1-9 * * *",
      title: "6min-9hr",
      why: "6 minutes × 9 hours = 54 triggers",
    },
  ];

  for (const { expr, title, why } of restrictedFieldExprs) {
    if (isWindows) {
      test(`${expr} throws on Windows (${why})`, () => {
        using dir = tempDir("bun-cron-test", {
          "job.ts": `export default { scheduled() {} };`,
        });
        expect(() => Bun.cron(`${dir}/job.ts`, expr, `test-win-${title}`)).toThrow(/too many triggers/i);
      });
    } else {
      test(`${expr} succeeds on ${isMacOS ? "macOS" : "Linux"}`, async () => {
        using dir = tempDir("bun-cron-test", {
          "job.ts": `export default { scheduled() {} };`,
        });
        const t = `test-win-${title}`;
        try {
          const result = await Bun.cron(`${dir}/job.ts`, expr, t);
          expect(result).toBeUndefined();
        } finally {
          await Bun.cron.remove(t);
        }
      });
    }
  }

  // Category 3: POSIX OR-split (both day-of-month and day-of-week non-wild)
  // doubles the trigger count per (hour, minute) pair.
  if (isWindows) {
    test("0,30 * 15 * 5 throws on Windows (2×24×2 = 96 triggers from OR-split)", () => {
      using dir = tempDir("bun-cron-test", {
        "job.ts": `export default { scheduled() {} };`,
      });
      expect(() => Bun.cron(`${dir}/job.ts`, "0,30 * 15 * 5", "test-win-or-split")).toThrow(/too many triggers/i);
    });
  } else {
    test(`0,30 * 15 * 5 succeeds on ${isMacOS ? "macOS" : "Linux"} (OR semantics)`, async () => {
      using dir = tempDir("bun-cron-test", {
        "job.ts": `export default { scheduled() {} };`,
      });
      const t = "test-win-or-split";
      try {
        const result = await Bun.cron(`${dir}/job.ts`, "0,30 * 15 * 5", t);
        expect(result).toBeUndefined();
      } finally {
        await Bun.cron.remove(t);
      }
    });
  }
});

// ==========================================================================
// Registration (Linux — crontab)
// ==========================================================================

describe.skipIf(!hasCrontab)("cron registration (Linux)", () => {
  test("accepts valid cron expressions", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    // Every minute
    await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-every-min");
    // Ranges, steps, lists
    await Bun.cron(`${dir}/job.ts`, "*/15 1-5 1,15 * 0-4", "test-complex");
    // Named days/months get normalized to numeric form in crontab
    await Bun.cron(`${dir}/job.ts`, "30 2 * * Monday", "test-named");
    const crontab = readCrontab();
    expect(crontab).toContain("# bun-cron: test-every-min");
    expect(crontab).toContain("# bun-cron: test-complex");
    expect(crontab).toContain("# bun-cron: test-named");
    // Verify "Monday" was normalized to "1" in the crontab entry
    const namedLine = crontab.split("\n").find((l: string) => l.includes("--cron-title=test-named"));
    expect(namedLine).toBeDefined();
    expect(namedLine).toStartWith("30 2 * * 1 ");
    expect(namedLine).not.toContain("Monday");
  });
  test("registers a crontab entry with absolute path", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });

    const scriptPath = `${dir}/job.ts`;
    await Bun.cron(scriptPath, "30 2 * * 1", "test-register");

    const crontab = readCrontab();
    expect(crontab).toContain("# bun-cron: test-register");
    expect(crontab).toContain("30 2 * * 1");
    expect(crontab).toContain(scriptPath);
  });

  test("crontab entry contains correct format", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });

    await Bun.cron(`${dir}/job.ts`, "15 3 * * 0", "test-format");

    const crontab = readCrontab();
    const lines = crontab.split("\n");
    const markerIdx = lines.findIndex((l: string) => l.includes("# bun-cron: test-format"));
    expect(markerIdx).toBeGreaterThanOrEqual(0);

    const commandLine = lines[markerIdx + 1];
    expect(commandLine).toStartWith("15 3 * * 0 ");
    expect(commandLine).toContain("--cron-title=test-format");
    expect(commandLine).toContain("--cron-period='15 3 * * 0'");
    expect(commandLine).toContain(`${dir}/job.ts`);
  });

  test("replaces existing entry with same title", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });

    await Bun.cron(`${dir}/job.ts`, "0 * * * *", "test-replace");
    await Bun.cron(`${dir}/job.ts`, "30 2 * * 1", "test-replace");

    const crontab = readCrontab();
    const count = (crontab.match(/# bun-cron: test-replace/g) || []).length;
    expect(count).toBe(1);
    expect(crontab).toContain("30 2 * * 1");
    expect(crontab).not.toContain("0 * * * *");
  });

  test("registers multiple different cron jobs", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "a.ts": `export default { scheduled() {} };`,
      "b.ts": `export default { scheduled() {} };`,
    });

    await Bun.cron(`${dir}/a.ts`, "0 * * * *", "multi-a");
    await Bun.cron(`${dir}/b.ts`, "30 12 * * 5", "multi-b");

    const crontab = readCrontab();
    expect(crontab).toContain("# bun-cron: multi-a");
    expect(crontab).toContain("# bun-cron: multi-b");
    expect(crontab).toContain("0 * * * *");
    expect(crontab).toContain("30 12 * * 5");
  });

  test("preserves existing non-bun crontab entries", async () => {
    using _restore = saveCrontabState();
    // Add a manual crontab entry first
    await using setup = Bun.spawn({
      cmd: [crontabPath!, "-"],
      stdin: "pipe",
    });
    setup.stdin.write("0 0 * * * /usr/bin/some-other-job\n");
    setup.stdin.end();
    await setup.exited;

    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    await Bun.cron(`${dir}/job.ts`, "*/5 * * * *", "test-preserve");

    const crontab = readCrontab();
    expect(crontab).toContain("/usr/bin/some-other-job");
    expect(crontab).toContain("# bun-cron: test-preserve");
  });

  test("returns a promise that resolves", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });

    const result = await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-promise");
    expect(result).toBeUndefined();
  });
});

// ==========================================================================
// Removal
// ==========================================================================

describe.skipIf(!hasCrontab)("cron removal (Linux)", () => {
  test("removes an existing cron entry", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });

    await Bun.cron(`${dir}/job.ts`, "30 2 * * 1", "rm-target");

    let crontab = readCrontab();
    expect(crontab).toContain("# bun-cron: rm-target");

    await Bun.cron.remove("rm-target");

    crontab = readCrontab();
    expect(crontab).not.toContain("# bun-cron: rm-target");
    expect(crontab).not.toContain("30 2 * * 1");
  });

  test("removing non-existent entry resolves without error", async () => {
    using _restore = saveCrontabState();
    const result = await Bun.cron.remove("rm-nonexistent");
    expect(result).toBeUndefined();
  });

  test("removes only the targeted entry", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "a.ts": `export default { scheduled() {} };`,
      "b.ts": `export default { scheduled() {} };`,
    });

    await Bun.cron(`${dir}/a.ts`, "0 * * * *", "rm-keep");
    await Bun.cron(`${dir}/b.ts`, "30 2 * * 1", "rm-delete");

    await Bun.cron.remove("rm-delete");

    const crontab = readCrontab();
    expect(crontab).toContain("# bun-cron: rm-keep");
    expect(crontab).not.toContain("# bun-cron: rm-delete");
  });

  test("register after remove works", async () => {
    using _restore = saveCrontabState();
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });

    await Bun.cron(`${dir}/job.ts`, "0 * * * *", "rm-reregister");
    await Bun.cron.remove("rm-reregister");

    let crontab = readCrontab();
    expect(crontab).not.toContain("# bun-cron: rm-reregister");

    await Bun.cron(`${dir}/job.ts`, "30 6 * * *", "rm-reregister");

    crontab = readCrontab();
    expect(crontab).toContain("# bun-cron: rm-reregister");
    expect(crontab).toContain("30 6 * * *");
  });
});

// ==========================================================================
// Registration & Removal (Windows — schtasks)
// ==========================================================================

function querySchtask(title: string): string | null {
  const result = Bun.spawnSync({
    cmd: ["schtasks", "/query", "/tn", `bun-cron-${title}`, "/fo", "LIST", "/v"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0 ? result.stdout.toString() : null;
}

function deleteSchtask(title: string) {
  Bun.spawnSync({
    cmd: ["schtasks", "/delete", "/tn", `bun-cron-${title}`, "/f"],
    stdout: "ignore",
    stderr: "ignore",
  });
}

describe.skipIf(!hasSchtasks)("cron registration (Windows)", () => {
  test("registers a scheduled task with correct task name", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-win-reg");
      const info = querySchtask("test-win-reg");
      expect(info).not.toBeNull();
      expect(info).toContain("bun-cron-test-win-reg");
    } finally {
      deleteSchtask("test-win-reg");
    }
  });

  test("task contains the bun command with cron flags", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "30 2 * * 1", "test-win-cmd");
      const info = querySchtask("test-win-cmd");
      expect(info).not.toBeNull();
      expect(info).toContain("--cron-title=test-win-cmd");
      expect(info).toContain("--cron-period");
    } finally {
      deleteSchtask("test-win-cmd");
    }
  });

  test("every-5-minutes schedule registers and is queryable", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "*/5 * * * *", "test-win-sched");
      const info = querySchtask("test-win-sched");
      expect(info).not.toBeNull();
      expect(info).toContain("bun-cron-test-win-sched");
    } finally {
      deleteSchtask("test-win-sched");
    }
  });

  test("returns a promise that resolves", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      const result = await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-win-promise");
      expect(result).toBeUndefined();
    } finally {
      deleteSchtask("test-win-promise");
    }
  });

  test("replaces existing task with same title", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "0 * * * *", "test-win-replace");
      await Bun.cron(`${dir}/job.ts`, "30 2 * * 1", "test-win-replace");
      const info = querySchtask("test-win-replace");
      expect(info).not.toBeNull();
    } finally {
      deleteSchtask("test-win-replace");
    }
  });

  test("registers multiple different tasks", async () => {
    using dir = tempDir("bun-cron-test", {
      "a.ts": `export default { scheduled() {} };`,
      "b.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/a.ts`, "0 * * * *", "test-win-multi-a");
      await Bun.cron(`${dir}/b.ts`, "30 12 * * 5", "test-win-multi-b");
      expect(querySchtask("test-win-multi-a")).not.toBeNull();
      expect(querySchtask("test-win-multi-b")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-multi-a");
      deleteSchtask("test-win-multi-b");
    }
  });
});

describe.skipIf(!hasSchtasks)("cron removal (Windows)", () => {
  test("removes an existing scheduled task", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-win-rm");
    expect(querySchtask("test-win-rm")).not.toBeNull();

    await Bun.cron.remove("test-win-rm");
    expect(querySchtask("test-win-rm")).toBeNull();
  });

  test("removing non-existent task resolves without error", async () => {
    const result = await Bun.cron.remove("test-win-nonexistent");
    expect(result).toBeUndefined();
  });

  test("removes only the targeted task", async () => {
    using dir = tempDir("bun-cron-test", {
      "a.ts": `export default { scheduled() {} };`,
      "b.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/a.ts`, "0 * * * *", "test-win-rm-keep");
      await Bun.cron(`${dir}/b.ts`, "30 2 * * 1", "test-win-rm-del");

      await Bun.cron.remove("test-win-rm-del");
      expect(querySchtask("test-win-rm-keep")).not.toBeNull();
      expect(querySchtask("test-win-rm-del")).toBeNull();
    } finally {
      deleteSchtask("test-win-rm-keep");
      deleteSchtask("test-win-rm-del");
    }
  });

  test("register after remove works", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "0 * * * *", "test-win-reregister");
      await Bun.cron.remove("test-win-reregister");
      expect(querySchtask("test-win-reregister")).toBeNull();

      await Bun.cron(`${dir}/job.ts`, "30 6 * * *", "test-win-reregister");
      expect(querySchtask("test-win-reregister")).not.toBeNull();
    } finally {
      deleteSchtask("test-win-reregister");
    }
  });
});

// ==========================================================================
// Registration & Removal (macOS — launchd)
// ==========================================================================

const plistDir = `${process.env.HOME}/Library/LaunchAgents`;

function plistPath(title: string): string {
  return `${plistDir}/bun.cron.${title}.plist`;
}

function queryLaunchdJob(title: string): boolean {
  const result = Bun.spawnSync({
    cmd: ["/bin/launchctl", "print", `gui/${process.getuid!()}/bun.cron.${title}`],
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0;
}

function removeLaunchdJob(title: string) {
  Bun.spawnSync({
    cmd: ["/bin/launchctl", "bootout", `gui/${process.getuid!()}/bun.cron.${title}`],
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    unlinkSync(plistPath(title));
  } catch {}
}

describe.skipIf(!hasLaunchctl)("cron registration (macOS)", () => {
  test("registers a launchd plist and bootstraps it", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-mac-reg");
      const plist = await Bun.file(plistPath("test-mac-reg")).text();
      expect(plist).toContain("bun.cron.test-mac-reg");
      expect(plist).toContain("StartCalendarInterval");
      expect(plist).toContain("--cron-title=test-mac-reg");
      expect(queryLaunchdJob("test-mac-reg")).toBe(true);
    } finally {
      removeLaunchdJob("test-mac-reg");
    }
  });

  test("returns a promise that resolves", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      const result = await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-mac-promise");
      expect(result).toBeUndefined();
    } finally {
      removeLaunchdJob("test-mac-promise");
    }
  });

  test("replaces existing job with same title", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "0 * * * *", "test-mac-replace");
      await Bun.cron(`${dir}/job.ts`, "30 2 * * 1", "test-mac-replace");
      const plist = await Bun.file(plistPath("test-mac-replace")).text();
      expect(plist).toContain("--cron-period=30 2 * * 1");
      expect(queryLaunchdJob("test-mac-replace")).toBe(true);
    } finally {
      removeLaunchdJob("test-mac-replace");
    }
  });

  test("plist contains correct CalendarInterval XML", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "30 2 * * 1", "test-mac-cal");
      const plist = await Bun.file(plistPath("test-mac-cal")).text();
      // Should have Minute=30, Hour=2, Weekday=1
      expect(plist).toContain("<key>Minute</key>");
      expect(plist).toContain("<integer>30</integer>");
      expect(plist).toContain("<key>Hour</key>");
      expect(plist).toContain("<integer>2</integer>");
      expect(plist).toContain("<key>Weekday</key>");
      expect(plist).toContain("<integer>1</integer>");
    } finally {
      removeLaunchdJob("test-mac-cal");
    }
  });

  test("named weekday 'Monday' normalized to integer 1 in plist", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "0 0 * * Monday", "test-mac-named-day");
      const plist = await Bun.file(plistPath("test-mac-named-day")).text();
      expect(plist).toContain("<key>Weekday</key>");
      expect(plist).toContain("<integer>1</integer>");
      expect(plist).not.toContain("Monday");
    } finally {
      removeLaunchdJob("test-mac-named-day");
    }
  });

  test("--cron-period in plist is normalized form (docs L157)", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // Register with named weekday — controller.cron should get normalized numeric form
      await Bun.cron(`${dir}/job.ts`, "30 2 * * MON", "test-mac-cron-period-norm");
      const plist = await Bun.file(plistPath("test-mac-cron-period-norm")).text();
      expect(plist).toContain("--cron-period=30 2 * * 1");
      expect(plist).not.toContain("MON");
    } finally {
      removeLaunchdJob("test-mac-cron-period-norm");
    }
  });

  test("@daily produces correct CalendarInterval (midnight)", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "@daily", "test-mac-daily");
      const plist = await Bun.file(plistPath("test-mac-daily")).text();
      expect(plist).toContain("<key>Minute</key>");
      expect(plist).toContain("<key>Hour</key>");
      // @daily = 0 0 * * * → Minute=0, Hour=0, no Day/Weekday
      expect(plist).not.toContain("<key>Day</key>");
      expect(plist).not.toContain("<key>Weekday</key>");
    } finally {
      removeLaunchdJob("test-mac-daily");
    }
  });

  test("POSIX OR semantics: day-of-month AND weekday produce separate dicts", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // '0 0 15 * 5' = 15th of month OR every Friday
      await Bun.cron(`${dir}/job.ts`, "0 0 15 * 5", "test-mac-or");
      const plist = await Bun.file(plistPath("test-mac-or")).text();
      // Should have separate dicts: one with Day=15 (no Weekday), one with Weekday=5 (no Day)
      expect(plist).toContain("<key>Day</key>");
      expect(plist).toContain("<integer>15</integer>");
      expect(plist).toContain("<key>Weekday</key>");
      expect(plist).toContain("<integer>5</integer>");
      // Should be an array (multiple dicts)
      expect(plist).toContain("<array>");
    } finally {
      removeLaunchdJob("test-mac-or");
    }
  });

  test("complex multi-value expression produces correct plist", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // '0 9 1,15 * *' = 1st and 15th of every month at 9am
      await Bun.cron(`${dir}/job.ts`, "0 9 1,15 * *", "test-mac-multi-dom");
      const plist = await Bun.file(plistPath("test-mac-multi-dom")).text();
      expect(plist).toContain("<key>Day</key>");
      // Should have both Day 1 and Day 15 in separate dicts
      const dayMatches = plist.match(/<key>Day<\/key>/g);
      expect(dayMatches?.length).toBe(2);
    } finally {
      removeLaunchdJob("test-mac-multi-dom");
    }
  });

  test("two varying fields produce Cartesian product (docs L220)", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      // 0,30 9,10 * * * → 2 minutes × 2 hours = 4 dicts
      await Bun.cron(`${dir}/job.ts`, "0,30 9,10 * * *", "test-mac-cartesian");
      const plist = await Bun.file(plistPath("test-mac-cartesian")).text();
      const arrayMatch = plist.match(/<key>StartCalendarInterval<\/key>\s*<array>([\s\S]*?)<\/array>/);
      expect(arrayMatch).not.toBeNull();
      const dictCount = (arrayMatch![1].match(/<dict>/g) || []).length;
      expect(dictCount).toBe(4);
    } finally {
      removeLaunchdJob("test-mac-cartesian");
    }
  });

  test("plist declares StandardOutPath and StandardErrorPath (docs L231-232)", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "0 0 * * *", "test-mac-logpaths");
      const plist = await Bun.file(plistPath("test-mac-logpaths")).text();
      expect(plist).toContain("<key>StandardOutPath</key>");
      expect(plist).toContain("<string>/tmp/bun.cron.test-mac-logpaths.stdout.log</string>");
      expect(plist).toContain("<key>StandardErrorPath</key>");
      expect(plist).toContain("<string>/tmp/bun.cron.test-mac-logpaths.stderr.log</string>");
    } finally {
      removeLaunchdJob("test-mac-logpaths");
    }
  });

  test("registers multiple different jobs", async () => {
    using dir = tempDir("bun-cron-test", {
      "a.ts": `export default { scheduled() {} };`,
      "b.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/a.ts`, "0 * * * *", "test-mac-multi-a");
      await Bun.cron(`${dir}/b.ts`, "30 12 * * 5", "test-mac-multi-b");
      expect(queryLaunchdJob("test-mac-multi-a")).toBe(true);
      expect(queryLaunchdJob("test-mac-multi-b")).toBe(true);
      expect(existsSync(plistPath("test-mac-multi-a"))).toBe(true);
      expect(existsSync(plistPath("test-mac-multi-b"))).toBe(true);
    } finally {
      removeLaunchdJob("test-mac-multi-a");
      removeLaunchdJob("test-mac-multi-b");
    }
  });
});

describe.skipIf(!hasLaunchctl)("cron removal (macOS)", () => {
  test("removes a launchd job and deletes the plist", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    await Bun.cron(`${dir}/job.ts`, "* * * * *", "test-mac-rm");
    expect(queryLaunchdJob("test-mac-rm")).toBe(true);

    await Bun.cron.remove("test-mac-rm");
    expect(queryLaunchdJob("test-mac-rm")).toBe(false);
    expect(existsSync(plistPath("test-mac-rm"))).toBe(false);
  });

  test("removing non-existent job resolves without error", async () => {
    const result = await Bun.cron.remove("test-mac-nonexistent");
    expect(result).toBeUndefined();
  });

  test("removes only the targeted job", async () => {
    using dir = tempDir("bun-cron-test", {
      "a.ts": `export default { scheduled() {} };`,
      "b.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/a.ts`, "0 * * * *", "test-mac-rm-keep");
      await Bun.cron(`${dir}/b.ts`, "30 2 * * 1", "test-mac-rm-del");

      await Bun.cron.remove("test-mac-rm-del");
      expect(queryLaunchdJob("test-mac-rm-keep")).toBe(true);
      expect(queryLaunchdJob("test-mac-rm-del")).toBe(false);
      expect(existsSync(plistPath("test-mac-rm-del"))).toBe(false);
    } finally {
      removeLaunchdJob("test-mac-rm-keep");
      removeLaunchdJob("test-mac-rm-del");
    }
  });

  test("register after remove works", async () => {
    using dir = tempDir("bun-cron-test", {
      "job.ts": `export default { scheduled() {} };`,
    });
    try {
      await Bun.cron(`${dir}/job.ts`, "0 * * * *", "test-mac-reregister");
      await Bun.cron.remove("test-mac-reregister");
      expect(queryLaunchdJob("test-mac-reregister")).toBe(false);

      await Bun.cron(`${dir}/job.ts`, "30 6 * * *", "test-mac-reregister");
      expect(queryLaunchdJob("test-mac-reregister")).toBe(true);
      const plist = await Bun.file(plistPath("test-mac-reregister")).text();
      expect(plist).toContain("--cron-period=30 6 * * *");
    } finally {
      removeLaunchdJob("test-mac-reregister");
    }
  });
});

describe.skipIf(!hasLaunchctl)("cron end-to-end (macOS)", () => {
  test("force-triggered job receives correct controller properties", async () => {
    const markerPath = `/tmp/bun-cron-e2e-${Date.now()}.json`;
    using dir = tempDir("bun-cron-test", {
      "e2e-job.ts": `
        export default {
          scheduled(controller) {
            require("node:fs").writeFileSync("${markerPath}", JSON.stringify({
              type: controller.type,
              cron: controller.cron,
              scheduledTime: controller.scheduledTime,
              keys: Object.keys(controller).sort(),
            }));
          }
        };
      `,
    });
    try {
      const before = Date.now();
      await Bun.cron(`${dir}/e2e-job.ts`, "0 0 * * *", "test-mac-e2e");

      Bun.spawnSync({
        cmd: ["/bin/launchctl", "kickstart", `gui/${process.getuid!()}/bun.cron.test-mac-e2e`],
      });

      // Wait for the marker file to appear
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const timer = setTimeout(() => {
        watcher.close();
        reject(new Error("Timed out"));
      }, 10000);
      const watcher = watch("/tmp", (_, f) => {
        if (f === basename(markerPath)) {
          watcher.close();
          clearTimeout(timer);
          resolve();
        }
      });
      if (existsSync(markerPath)) {
        watcher.close();
        clearTimeout(timer);
        resolve();
      }
      await promise;

      const output = JSON.parse(readFileSync(markerPath, "utf8"));
      const after = Date.now();
      expect(output.type).toBe("scheduled");
      expect(output.cron).toBe("0 0 * * *");
      expect(typeof output.scheduledTime).toBe("number");
      expect(output.scheduledTime).toBeGreaterThanOrEqual(before - 5000);
      expect(output.scheduledTime).toBeLessThanOrEqual(after + 5000);
      // Verify exactly these three keys, no extras
      expect(output.keys).toEqual(["cron", "scheduledTime", "type"]);
    } finally {
      removeLaunchdJob("test-mac-e2e");
      try {
        unlinkSync(markerPath);
      } catch {}
      try {
        unlinkSync("/tmp/bun.cron.test-mac-e2e.stdout.log");
      } catch {}
      try {
        unlinkSync("/tmp/bun.cron.test-mac-e2e.stderr.log");
      } catch {}
    }
  });
});

// ==========================================================================
// Cron execution mode (--cron-title / --cron-period)
// ==========================================================================

describe("cron execution mode", () => {
  test("calls default.scheduled with controller object", async () => {
    using dir = tempDir("bun-cron-test", {
      "scheduled.ts": `
        export default {
          scheduled(controller: any) {
            console.log(JSON.stringify({
              type: controller.type,
              cron: controller.cron,
              scheduledTime: controller.scheduledTime,
              keys: Object.keys(controller).sort(),
            }));
          }
        };
      `,
    });

    const before = Date.now();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cron-title=my-job", "--cron-period=30 2 * * 1", `${dir}/scheduled.ts`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const after = Date.now();

    const output = JSON.parse(stdout.trim());
    // Verify exact property names and types
    expect(output.type).toBe("scheduled");
    expect(output.cron).toBe("30 2 * * 1");
    expect(typeof output.scheduledTime).toBe("number");
    // scheduledTime should be close to now (within 5 seconds)
    expect(output.scheduledTime).toBeGreaterThanOrEqual(before - 1000);
    expect(output.scheduledTime).toBeLessThanOrEqual(after + 1000);
    // Verify the controller has exactly these three keys
    expect(output.keys).toEqual(["cron", "scheduledTime", "type"]);
    expect(exitCode).toBe(0);
  });

  test("handles async scheduled handler", async () => {
    using dir = tempDir("bun-cron-test", {
      "async-scheduled.ts": `
        export default {
          async scheduled(controller: any) {
            await Bun.sleep(10);
            console.log("async-done");
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cron-title=async-job", "--cron-period=* * * * *", `${dir}/async-scheduled.ts`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("async-done");
    expect(exitCode).toBe(0);
  });

  test("async rejected handler also settles (docs L164: 'settle')", async () => {
    using dir = tempDir("bun-cron-test", {
      "reject-scheduled.ts": `
        export default {
          async scheduled() {
            await Bun.sleep(10);
            console.log("before-throw");
            throw new Error("intentional");
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cron-title=reject-job", "--cron-period=* * * * *", `${dir}/reject-scheduled.ts`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The await completed (proved by before-throw appearing), then rejection propagated
    expect(stdout.trim()).toBe("before-throw");
    expect(stderr).toContain("intentional");
    expect(exitCode).not.toBe(0);
  });

  test("exits with error when no scheduled method", async () => {
    using dir = tempDir("bun-cron-test", {
      "no-scheduled.ts": `export default { hello: "world" };`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cron-title=bad-job", "--cron-period=* * * * *", `${dir}/no-scheduled.ts`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).not.toBe(0);
  });

  test("handles CJS module with default export", async () => {
    using dir = tempDir("bun-cron-test", {
      "cjs-scheduled.cjs": `
        module.exports = {
          scheduled(controller) {
            console.log("cjs-" + controller.type);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cron-title=cjs-job", "--cron-period=* * * * *", `${dir}/cjs-scheduled.cjs`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("cjs-scheduled");
    expect(exitCode).toBe(0);
  });

  test("scheduled handler receives scheduledTime as number", async () => {
    using dir = tempDir("bun-cron-test", {
      "time-check.ts": `
        export default {
          scheduled(controller: any) {
            const now = Date.now();
            const diff = Math.abs(now - controller.scheduledTime);
            // scheduledTime should be within 5 seconds of now
            console.log(diff < 5000 ? "ok" : "bad-" + diff);
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cron-title=time-job", "--cron-period=* * * * *", `${dir}/time-check.ts`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
});

// ==========================================================================
// Bun.cron.parse
// ==========================================================================

/**
 * Collect the next N occurrences by chaining parse() calls.
 * This is the real test: if the pattern is parsed correctly,
 * calling next() repeatedly should produce the right sequence.
 */
function nextN(expr: string, from: number, n: number): number[] {
  const results: number[] = [];
  let cursor = from;
  for (let i = 0; i < n; i++) {
    const d = Bun.cron.parse(expr, cursor);
    if (!d) break;
    results.push(d.getTime());
    cursor = d.getTime();
  }
  return results;
}

describe("Bun.cron.parse", () => {
  test("is a function that returns a Date", () => {
    expect(typeof Bun.cron.parse).toBe("function");
    const result = Bun.cron.parse("* * * * *", Date.UTC(2025, 0, 15, 10, 30, 0));
    expect(result).toBeInstanceOf(Date);
  });

  // --- Verify patterns via sequential next() calls ---

  test("*/15 produces :00, :15, :30, :45, :00 sequence", () => {
    // Start before midnight so we can see the hour roll
    const from = Date.UTC(2025, 0, 15, 10, 58, 0);
    expect(nextN("*/15 * * * *", from, 5)).toEqual([
      Date.UTC(2025, 0, 15, 11, 0, 0),
      Date.UTC(2025, 0, 15, 11, 15, 0),
      Date.UTC(2025, 0, 15, 11, 30, 0),
      Date.UTC(2025, 0, 15, 11, 45, 0),
      Date.UTC(2025, 0, 15, 12, 0, 0),
    ]);
  });

  test("0 */6 produces 00:00, 06:00, 12:00, 18:00, 00:00 sequence", () => {
    const from = Date.UTC(2025, 0, 15, 0, 0, 0);
    expect(nextN("0 */6 * * *", from, 5)).toEqual([
      Date.UTC(2025, 0, 15, 6, 0, 0),
      Date.UTC(2025, 0, 15, 12, 0, 0),
      Date.UTC(2025, 0, 15, 18, 0, 0),
      Date.UTC(2025, 0, 16, 0, 0, 0),
      Date.UTC(2025, 0, 16, 6, 0, 0),
    ]);
  });

  test("0 0 * * MON,WED,FRI produces correct weekday sequence", () => {
    // Tue Jan 14 2025
    const from = Date.UTC(2025, 0, 14, 0, 0, 0);
    const results = nextN("0 0 * * MON,WED,FRI", from, 5);
    expect(results).toEqual([
      Date.UTC(2025, 0, 15, 0, 0, 0), // Wed
      Date.UTC(2025, 0, 17, 0, 0, 0), // Fri
      Date.UTC(2025, 0, 20, 0, 0, 0), // Mon
      Date.UTC(2025, 0, 22, 0, 0, 0), // Wed
      Date.UTC(2025, 0, 24, 0, 0, 0), // Fri
    ]);
    // Verify actual weekdays (0=Sun, 1=Mon, 3=Wed, 5=Fri)
    expect(results.map(t => new Date(t).getUTCDay())).toEqual([3, 5, 1, 3, 5]);
  });

  test("0 9 * * MON-FRI produces consecutive weekday mornings", () => {
    // Fri Jan 17 2025 at noon
    const from = Date.UTC(2025, 0, 17, 12, 0, 0);
    const results = nextN("0 9 * * MON-FRI", from, 5);
    // Should skip Sat+Sun, then Mon-Fri
    expect(results).toEqual([
      Date.UTC(2025, 0, 20, 9, 0, 0), // Mon
      Date.UTC(2025, 0, 21, 9, 0, 0), // Tue
      Date.UTC(2025, 0, 22, 9, 0, 0), // Wed
      Date.UTC(2025, 0, 23, 9, 0, 0), // Thu
      Date.UTC(2025, 0, 24, 9, 0, 0), // Fri
    ]);
    expect(results.map(t => new Date(t).getUTCDay())).toEqual([1, 2, 3, 4, 5]);
  });

  test("@weekly produces consecutive Sundays", () => {
    const from = Date.UTC(2025, 0, 12, 0, 0, 0); // Sun Jan 12
    const results = nextN("@weekly", from, 4);
    expect(results).toEqual([
      Date.UTC(2025, 0, 19, 0, 0, 0),
      Date.UTC(2025, 0, 26, 0, 0, 0),
      Date.UTC(2025, 1, 2, 0, 0, 0),
      Date.UTC(2025, 1, 9, 0, 0, 0),
    ]);
    expect(results.every(t => new Date(t).getUTCDay() === 0)).toBe(true);
  });

  test("@monthly produces 1st of consecutive months", () => {
    const from = Date.UTC(2025, 0, 15, 0, 0, 0);
    expect(nextN("@monthly", from, 4)).toEqual([
      Date.UTC(2025, 1, 1, 0, 0, 0),
      Date.UTC(2025, 2, 1, 0, 0, 0),
      Date.UTC(2025, 3, 1, 0, 0, 0),
      Date.UTC(2025, 4, 1, 0, 0, 0),
    ]);
  });

  test("0 0 31 * * skips months without 31 days", () => {
    const from = Date.UTC(2025, 0, 1, 0, 0, 0);
    const results = nextN("0 0 31 * *", from, 4);
    // Jan 31, Mar 31, May 31, Jul 31 (skips Feb, Apr, Jun)
    expect(results).toEqual([
      Date.UTC(2025, 0, 31, 0, 0, 0),
      Date.UTC(2025, 2, 31, 0, 0, 0),
      Date.UTC(2025, 4, 31, 0, 0, 0),
      Date.UTC(2025, 6, 31, 0, 0, 0),
    ]);
  });

  // --- POSIX OR logic: the critical behavioral test ---

  test("OR logic: '0 0 15 * FRI' matches BOTH the 15th AND every Friday", () => {
    // This is the defining test for POSIX cron OR behavior.
    // With AND logic, this would only match Fridays that fall on the 15th (~once a year).
    // With OR logic, it matches the 15th of any month AND every Friday.
    // Jan 2025: 15th is Wed, Fridays are 3,10,17,24,31
    const from = Date.UTC(2025, 0, 1, 0, 0, 0);
    const results = nextN("0 0 15 * FRI", from, 6);
    expect(results).toEqual([
      Date.UTC(2025, 0, 3, 0, 0, 0), // Fri Jan 3
      Date.UTC(2025, 0, 10, 0, 0, 0), // Fri Jan 10
      Date.UTC(2025, 0, 15, 0, 0, 0), // Wed Jan 15 (15th, not a Friday!)
      Date.UTC(2025, 0, 17, 0, 0, 0), // Fri Jan 17
      Date.UTC(2025, 0, 24, 0, 0, 0), // Fri Jan 24
      Date.UTC(2025, 0, 31, 0, 0, 0), // Fri Jan 31
    ]);
    // Verify: Jan 15 is NOT a Friday (it's Wednesday=3), proving OR logic
    expect(new Date(results[2]).getUTCDay()).toBe(3); // Wednesday
    expect(new Date(results[2]).getUTCDate()).toBe(15); // 15th
  });

  test("OR logic: '0 0 1 * MON' fires on 1st AND on Mondays", () => {
    // Feb 2025: 1st is Saturday, Mondays are 3,10,17,24, Mar 1 is Saturday
    // Need to see enough results to hit a 1st-of-month that ISN'T a Monday
    const from = Date.UTC(2025, 1, 1, 0, 0, 0);
    const results = nextN("0 0 1 * MON", from, 8);
    expect(results).toEqual([
      Date.UTC(2025, 1, 3, 0, 0, 0), // Mon Feb 3
      Date.UTC(2025, 1, 10, 0, 0, 0), // Mon Feb 10
      Date.UTC(2025, 1, 17, 0, 0, 0), // Mon Feb 17
      Date.UTC(2025, 1, 24, 0, 0, 0), // Mon Feb 24
      Date.UTC(2025, 2, 1, 0, 0, 0), // Sat Mar 1 — matches day-of-month, NOT a Monday!
      Date.UTC(2025, 2, 3, 0, 0, 0), // Mon Mar 3
      Date.UTC(2025, 2, 10, 0, 0, 0), // Mon Mar 10
      Date.UTC(2025, 2, 17, 0, 0, 0), // Mon Mar 17
    ]);
    // Mar 1 is Saturday (6), proving OR logic: it matched on day-of-month alone
    expect(new Date(results[4]).getUTCDay()).toBe(6); // Saturday
    expect(new Date(results[4]).getUTCDate()).toBe(1); // 1st
  });

  test("wildcard day + specific weekday: only weekday matters", () => {
    // "0 0 * * 1" — day-of-month is *, only Monday matters
    const from = Date.UTC(2025, 0, 14, 10, 0, 0); // Tue
    const results = nextN("0 0 * * 1", from, 3);
    expect(results).toEqual([
      Date.UTC(2025, 0, 20, 0, 0, 0),
      Date.UTC(2025, 0, 27, 0, 0, 0),
      Date.UTC(2025, 1, 3, 0, 0, 0),
    ]);
    expect(results.every(t => new Date(t).getUTCDay() === 1)).toBe(true);
  });

  test("specific day + wildcard weekday: only day matters", () => {
    // "0 0 15 * *" — weekday is *, only 15th matters
    const from = Date.UTC(2025, 0, 1, 0, 0, 0);
    const results = nextN("0 0 15 * *", from, 3);
    expect(results).toEqual([
      Date.UTC(2025, 0, 15, 0, 0, 0),
      Date.UTC(2025, 1, 15, 0, 0, 0),
      Date.UTC(2025, 2, 15, 0, 0, 0),
    ]);
    expect(results.every(t => new Date(t).getUTCDate() === 15)).toBe(true);
  });

  // --- Named days: verify via weekday sequences ---

  test("SUN through SAT each map to the correct weekday", () => {
    const from = Date.UTC(2025, 0, 11, 0, 0, 0); // Saturday Jan 11
    const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    for (let i = 0; i < 7; i++) {
      const result = Bun.cron.parse(`0 0 * * ${names[i]}`, from)!;
      expect(new Date(result).getUTCDay()).toBe(i);
    }
  });

  test("full day names match 3-letter abbreviations", () => {
    const from = Date.UTC(2025, 0, 14, 10, 0, 0);
    const pairs: [string, string][] = [
      ["SUN", "Sunday"],
      ["MON", "Monday"],
      ["TUE", "Tuesday"],
      ["WED", "Wednesday"],
      ["THU", "Thursday"],
      ["FRI", "Friday"],
      ["SAT", "Saturday"],
    ];
    for (const [abbr, full] of pairs) {
      expect(Bun.cron.parse(`0 0 * * ${abbr}`, from)!.getTime()).toBe(
        Bun.cron.parse(`0 0 * * ${full}`, from)!.getTime(),
      );
    }
  });

  test("weekday names are case-insensitive (docs L85)", () => {
    const from = Date.UTC(2025, 0, 14, 10, 0, 0);
    const upper = Bun.cron.parse("0 0 * * MON", from)!;
    const lower = Bun.cron.parse("0 0 * * mon", from)!;
    const mixed = Bun.cron.parse("0 0 * * Mon", from)!;
    expect(lower.getTime()).toBe(upper.getTime());
    expect(mixed.getTime()).toBe(upper.getTime());
  });

  test("month names are case-insensitive (docs L85)", () => {
    const from = Date.UTC(2025, 0, 1, 0, 0, 0);
    const upper = Bun.cron.parse("0 0 1 JUN *", from)!;
    const lower = Bun.cron.parse("0 0 1 jun *", from)!;
    const mixed = Bun.cron.parse("0 0 1 Jun *", from)!;
    const full = Bun.cron.parse("0 0 1 june *", from)!;
    expect(lower.getTime()).toBe(upper.getTime());
    expect(mixed.getTime()).toBe(upper.getTime());
    expect(full.getTime()).toBe(upper.getTime());
  });

  test("MON-FRI/2 produces Mon, Wed, Fri", () => {
    const from = Date.UTC(2025, 0, 18, 12, 0, 0); // Saturday
    const results = nextN("0 0 * * MON-FRI/2", from, 6);
    // Mon=1, Wed=3, Fri=5 repeating
    expect(results.map(t => new Date(t).getUTCDay())).toEqual([1, 3, 5, 1, 3, 5]);
  });

  test("day 7 and SUN both schedule on Sundays", () => {
    const from = Date.UTC(2025, 0, 13, 0, 0, 0); // Monday
    expect(nextN("0 0 * * 7", from, 3)).toEqual(nextN("0 0 * * SUN", from, 3));
    expect(nextN("0 0 * * 0", from, 3)).toEqual(nextN("0 0 * * 7", from, 3));
  });

  // --- Named months: verify via sequences ---

  test("JAN through DEC each map to the correct month", () => {
    const names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const from = Date.UTC(2024, 11, 1, 0, 0, 0); // Dec 2024
    for (let i = 0; i < 12; i++) {
      const result = Bun.cron.parse(`0 0 1 ${names[i]} *`, from)!;
      expect(new Date(result).getUTCMonth()).toBe(i);
    }
  });

  test("full month names match abbreviations", () => {
    const from = Date.UTC(2025, 0, 1, 0, 0, 0);
    const pairs: [string, string][] = [
      ["JAN", "January"],
      ["FEB", "February"],
      ["MAR", "March"],
      ["JUN", "June"],
      ["SEP", "September"],
      ["DEC", "December"],
    ];
    for (const [abbr, full] of pairs) {
      expect(Bun.cron.parse(`0 0 1 ${abbr} *`, from)!.getTime()).toBe(
        Bun.cron.parse(`0 0 1 ${full} *`, from)!.getTime(),
      );
    }
  });

  test("JAN-MAR produces Jan, Feb, Mar sequence", () => {
    const from = Date.UTC(2024, 11, 1, 0, 0, 0); // Dec 2024
    const results = nextN("0 0 1 JAN-MAR *", from, 4);
    expect(results).toEqual([
      Date.UTC(2025, 0, 1, 0, 0, 0),
      Date.UTC(2025, 1, 1, 0, 0, 0),
      Date.UTC(2025, 2, 1, 0, 0, 0),
      Date.UTC(2026, 0, 1, 0, 0, 0),
    ]);
  });

  // --- Nicknames verified against equivalent expressions ---

  test("@yearly equals '0 0 1 1 *'", () => {
    const from = Date.UTC(2025, 0, 1, 0, 0, 0);
    expect(nextN("@yearly", from, 3)).toEqual(nextN("0 0 1 1 *", from, 3));
    expect(nextN("@annually", from, 3)).toEqual(nextN("0 0 1 1 *", from, 3));
  });

  test("@daily equals '0 0 * * *'", () => {
    const from = Date.UTC(2025, 0, 15, 0, 0, 0);
    expect(nextN("@daily", from, 5)).toEqual(nextN("0 0 * * *", from, 5));
    expect(nextN("@midnight", from, 5)).toEqual(nextN("0 0 * * *", from, 5));
  });

  test("@hourly equals '0 * * * *'", () => {
    const from = Date.UTC(2025, 0, 15, 10, 0, 0);
    expect(nextN("@hourly", from, 5)).toEqual(nextN("0 * * * *", from, 5));
  });

  test("nicknames with leading/trailing whitespace work", () => {
    const from = Date.UTC(2025, 0, 15, 10, 0, 0);
    const expected = Bun.cron.parse("@daily", from)!.getTime();
    expect(Bun.cron.parse("  @daily", from)!.getTime()).toBe(expected);
    expect(Bun.cron.parse("@daily  ", from)!.getTime()).toBe(expected);
    expect(Bun.cron.parse("  @DAILY  ", from)!.getTime()).toBe(expected);
  });

  test("invalid nicknames throw", () => {
    expect(() => Bun.cron.parse("@invalid")).toThrow(/cron expression/i);
    expect(() => Bun.cron.parse("@")).toThrow(/cron expression/i);
  });

  // --- Boundary and edge cases ---

  test("year boundary: Dec 31 → Jan 1", () => {
    const from = Date.UTC(2025, 11, 31, 23, 30, 0);
    expect(Bun.cron.parse("0 0 1 1 *", from)!.getTime()).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
  });

  test("leap year Feb 29 scheduling", () => {
    // From Jan 1 2024, next Feb 29 should be 2024 (leap year)
    const from = Date.UTC(2024, 0, 1, 0, 0, 0);
    const results = nextN("0 0 29 2 *", from, 2);
    expect(results[0]).toBe(Date.UTC(2024, 1, 29, 0, 0, 0));
    // Next is 2028 (next leap year)
    expect(results[1]).toBe(Date.UTC(2028, 1, 29, 0, 0, 0));
  });

  test("impossible expression (Feb 30) returns null", () => {
    expect(Bun.cron.parse("0 0 30 2 *", Date.UTC(2025, 0, 1, 0, 0, 0))).toBeNull();
  });

  test("whitespace: multiple spaces, tabs, leading/trailing", () => {
    const from = Date.UTC(2025, 0, 15, 10, 30, 0);
    const expected = Date.UTC(2025, 0, 15, 10, 31, 0);
    expect(Bun.cron.parse("*  *  *  *  *", from)!.getTime()).toBe(expected);
    expect(Bun.cron.parse("*\t*\t*\t*\t*", from)!.getTime()).toBe(expected);
    expect(Bun.cron.parse("  * * * * *  ", from)!.getTime()).toBe(expected);
  });

  // --- Error cases ---

  test("rejects invalid expressions", () => {
    expect(() => Bun.cron.parse("not a cron")).toThrow(/cron expression/i);
    expect(() => Bun.cron.parse("* * *")).toThrow(/cron expression/i);
    expect(() => Bun.cron.parse("* * * * * *")).toThrow(/cron expression/i);
    // @ts-ignore
    expect(() => Bun.cron.parse(123)).toThrow();
  });

  test("rejects out-of-range values", () => {
    expect(() => Bun.cron.parse("60 * * * *")).toThrow();
    expect(() => Bun.cron.parse("* 24 * * *")).toThrow();
    expect(() => Bun.cron.parse("* * 0 * *")).toThrow();
    expect(() => Bun.cron.parse("* * 32 * *")).toThrow();
    expect(() => Bun.cron.parse("* * * 0 *")).toThrow();
    expect(() => Bun.cron.parse("* * * 13 *")).toThrow();
    expect(() => Bun.cron.parse("* * * * 8")).toThrow(); // 7 is OK (Sunday), 8 is not
  });

  test("rejects malformed fields", () => {
    expect(() => Bun.cron.parse("1,,3 * * * *")).toThrow();
    expect(() => Bun.cron.parse(",1 * * * *")).toThrow();
    expect(() => Bun.cron.parse("*/0 * * * *")).toThrow();
    expect(() => Bun.cron.parse("* * * * FOO")).toThrow();
    expect(() => Bun.cron.parse("* * * * Mond")).toThrow();
    expect(() => Bun.cron.parse("* * * FOO *")).toThrow();
    expect(() => Bun.cron.parse("* * * Janu *")).toThrow();
  });

  test("rejects invalid Date arguments", () => {
    expect(() => Bun.cron.parse("* * * * *", NaN)).toThrow(/Invalid date/i);
    expect(() => Bun.cron.parse("* * * * *", Infinity)).toThrow(/Invalid date/i);
    // @ts-ignore
    expect(() => Bun.cron.parse("* * * * *", "not a date")).toThrow();
  });

  test("null/undefined relativeDate uses current time", () => {
    const before = Date.now();
    const result1 = Bun.cron.parse("* * * * *")!;
    // @ts-ignore
    const result2 = Bun.cron.parse("* * * * *", null)!;
    const after = Date.now();
    for (const result of [result1, result2]) {
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after + 2 * 60 * 1000);
    }
  });

  test("Date object input works the same as number", () => {
    const ms = Date.UTC(2025, 0, 15, 10, 30, 0);
    const fromNumber = Bun.cron.parse("30 * * * *", ms)!;
    const fromDate = Bun.cron.parse("30 * * * *", new Date(ms))!;
    expect(fromNumber.getTime()).toBe(fromDate.getTime());
  });
});
