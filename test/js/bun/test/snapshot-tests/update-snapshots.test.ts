import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
const entry = (key: string, value: string) => "\nexports[`" + key + "`] = `" + value + "`;\n";

// The tests run zeta, mid, alpha. The committed file lists alpha before zeta.
const orderTest = /*js*/ `
  import { describe, expect, test } from "bun:test";
  describe("suite", () => {
    test("zeta", () => { expect({ z: 1 }).toMatchSnapshot(); });
    test("mid", () => { expect({ m: 1 }).toMatchSnapshot(); });
    test("alpha", () => { expect({ a: 1 }).toMatchSnapshot(); });
  });
`;

const alphaEntry = entry("suite alpha 1", '\n{\n  "a": 1,\n}\n');
const zetaEntry = entry("suite zeta 1", '\n{\n  "z": 1,\n}\n');
const midEntry = entry("suite mid 1", '\n{\n  "m": 1,\n}\n');
const staleEntry = entry("suite gone 1", '\n{\n  "gone": true,\n}\n');

async function runUpdate(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--update-snapshots", "./order.test.ts"],
    cwd: String(dir),
    env: { ...bunEnv, CI: "false" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

describe("--update-snapshots", () => {
  test.concurrent("keeps the order of the existing file and appends new keys", async () => {
    using dir = tempDir("update-snapshots-order", {
      "order.test.ts": orderTest,
      "__snapshots__": { "order.test.ts.snap": header + alphaEntry + zetaEntry },
    });
    const { stderr, exitCode } = await runUpdate(String(dir));
    expect(await Bun.file(`${dir}/__snapshots__/order.test.ts.snap`).text()).toBe(
      header + alphaEntry + zetaEntry + midEntry,
    );
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("snapshots: +3 added");
    expect(exitCode).toBe(0);
  });

  test.concurrent("rewrites a changed value in place and drops keys no test uses", async () => {
    using dir = tempDir("update-snapshots-changed", {
      "order.test.ts": orderTest,
      "__snapshots__": {
        "order.test.ts.snap":
          header + staleEntry + alphaEntry + entry("suite zeta 1", '\n{\n  "z": 0,\n}\n') + midEntry,
      },
    });
    const { stderr, exitCode } = await runUpdate(String(dir));
    expect(await Bun.file(`${dir}/__snapshots__/order.test.ts.snap`).text()).toBe(
      header + alphaEntry + zetaEntry + midEntry,
    );
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("snapshots: +3 added");
    expect(exitCode).toBe(0);
  });

  test.concurrent("rewrites a file it cannot parse from scratch", async () => {
    using dir = tempDir("update-snapshots-corrupt", {
      "order.test.ts": orderTest,
      "__snapshots__": { "order.test.ts.snap": header + "exports[`suite alpha 1`] = `\n{\n" },
    });
    const { stderr, exitCode } = await runUpdate(String(dir));
    expect(await Bun.file(`${dir}/__snapshots__/order.test.ts.snap`).text()).toBe(
      header + zetaEntry + midEntry + alphaEntry,
    );
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("snapshots: +3 added");
    expect(exitCode).toBe(0);
  });

  test.concurrent("writes a new file in execution order", async () => {
    using dir = tempDir("update-snapshots-new", { "order.test.ts": orderTest });
    const { stderr, exitCode } = await runUpdate(String(dir));
    expect(await Bun.file(`${dir}/__snapshots__/order.test.ts.snap`).text()).toBe(
      header + zetaEntry + midEntry + alphaEntry,
    );
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("snapshots: +3 added");
    expect(exitCode).toBe(0);
  });
});
