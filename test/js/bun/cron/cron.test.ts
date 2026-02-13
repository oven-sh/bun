import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { unlinkSync, writeFileSync } from "node:fs";

function readCrontab(): string {
  const result = Bun.spawnSync({
    cmd: ["/usr/bin/crontab", "-l"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0 ? result.stdout.toString() : "";
}

function writeCrontab(content: string) {
  const tmpFile = `/tmp/bun-cron-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmpFile, content);
  try {
    Bun.spawnSync({ cmd: ["/usr/bin/crontab", tmpFile] });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

let savedCrontab: string | null = null;

function saveCrontab() {
  savedCrontab = readCrontab();
}

function restoreCrontab() {
  if (savedCrontab !== null) {
    writeCrontab(savedCrontab);
    savedCrontab = null;
  }
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

  test("remove throws with invalid title characters", () => {
    expect(() => Bun.cron.remove("bad title!")).toThrow(/alphanumeric/);
  });
});

// ==========================================================================
// Registration (Linux only — uses crontab)
// ==========================================================================

describe.skipIf(!isLinux)("cron registration", () => {
  beforeEach(saveCrontab);
  afterEach(restoreCrontab);

  test("accepts valid cron expressions", async () => {
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
    // Add a manual crontab entry first
    await using setup = Bun.spawn({
      cmd: ["/usr/bin/crontab", "-"],
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

describe.skipIf(!isLinux)("cron removal", () => {
  beforeEach(saveCrontab);
  afterEach(restoreCrontab);
  test("removes an existing cron entry", async () => {
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
    const result = await Bun.cron.remove("rm-nonexistent");
    expect(result).toBeUndefined();
  });

  test("removes only the targeted entry", async () => {
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
              hasScheduledTime: typeof controller.scheduledTime === "number",
            }));
          }
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cron-title=my-job", "--cron-period=30 2 * * 1", `${dir}/scheduled.ts`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const output = JSON.parse(stdout.trim());
    expect(output).toEqual({
      type: "scheduled",
      cron: "30 2 * * 1",
      hasScheduledTime: true,
    });
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
