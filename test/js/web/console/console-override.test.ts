import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// In Node.js the global console's derived methods (count, table, group, time*,
// trace, assert, dirxml) call through `this.log` / `this.warn` / `this.error`,
// so replacing those slots captures their output. Bun's native console used to
// write these straight to the fd via the JSC ConsoleClient, so a spy on
// `console.log` saw nothing.
test.concurrent("console.count/table/group/time*/trace/assert route through this.log/warn/error", async () => {
  const script = `
    const cap = [];
    const orig = {};
    for (const m of ["log", "info", "warn", "error", "debug", "dir"]) {
      orig[m] = console[m];
      console[m] = (...a) => cap.push(m + ":" + String(a[0]).split("\\n")[0].slice(0, 24));
    }
    console.count("cc");
    console.table([{ a: 1 }]);
    console.group("g"); console.groupEnd();
    console.groupCollapsed("gc"); console.groupEnd();
    console.time("t"); console.timeLog("t"); console.timeEnd("t");
    console.trace("tr");
    console.assert(false, "as");
    console.assert(false, { a: 1 });
    console.dirxml("dx");
    console.dir({ d: 1 });
    let tableThrew;
    try { console.table([{}], "notArray"); } catch (e) { tableThrew = e.code; }
    for (const m of Object.keys(orig)) console[m] = orig[m];
    process.stdout.write("CAPTURED=" + JSON.stringify(cap) + "|" + tableThrew + "\\n");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Nothing should have reached the real stdout/stderr except the CAPTURED line.
  expect(stderr).toBe("");
  const lines = stdout.split("\n").filter(Boolean);
  expect(lines.length).toBe(1);
  expect(lines[0].startsWith("CAPTURED=")).toBe(true);

  const [capturedJson, tableThrew] = lines[0].slice("CAPTURED=".length).split("|");
  const captured = JSON.parse(capturedJson);
  const sinks = captured.map((s: string) => s.split(":", 1)[0]);
  expect(sinks).toEqual([
    "log", // count
    "log", // table
    "log", // group label
    "log", // groupCollapsed label
    "log", // timeLog
    "log", // timeEnd
    "error", // trace
    "warn", // assert (string)
    "warn", // assert (object)
    "log", // dirxml
    "dir", // dir (replaced directly)
  ]);
  expect(captured[0]).toBe("log:cc: 1");
  expect(captured[6].startsWith("error:Trace")).toBe(true);
  expect(captured[7]).toBe("warn:Assertion failed: as");
  expect(captured[8]).toBe("warn:Assertion failed");
  expect(tableThrew).toBe("ERR_INVALID_ARG_TYPE");
  expect(exitCode).toBe(0);
});

test.concurrent("console.group still indents subsequent native console.log output", async () => {
  const script = `
    const orig = console.log;
    let captured;
    console.log = (...a) => { captured = a[0]; };
    console.group("g");
    console.log = orig;
    console.log("inside");
    console.groupEnd();
    console.log("outside");
    process.stderr.write("captured=" + captured + "\\n");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("captured=g\n");
  expect(stdout).toBe("  inside\noutside\n");
  expect(exitCode).toBe(0);
});
