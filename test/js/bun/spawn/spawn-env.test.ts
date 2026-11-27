import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("spawn env", async () => {
  const env = {};
  Object.defineProperty(env, "LOL", {
    get() {
      throw new Error("Bad!!");
    },
    configurable: false,
    enumerable: true,
  });

  // This was the minimum to reliably cause a crash in Bun < v1.1.42
  for (let i = 0; i < 1024 * 10; i++) {
    try {
      const result = spawn({
        env,
        cmd: [bunExe(), "-e", "console.log(process.env.LOL)"],
      });
    } catch (e) {}
  }
});

// A Symbol key is not an environment variable name. It used to reach the
// child as a variable named by the symbol description.
test("spawn env skips Symbol keys", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", "console.log(JSON.stringify([process.env.SYMKEY ?? null, process.env.PLAIN]))"],
    env: { ...bunEnv, PLAIN: "1", [Symbol("SYMKEY")]: "leaked" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe('[null,"1"]\n');
  expect(exitCode).toBe(0);
});

test("spawn env and argv reach the child as UTF-8 from either string encoding", async () => {
  const long = Buffer.alloc(5000, "x").toString();
  const values = ["", "ascii", "latin1-é", "utf16-日本語-😀", "lone-\ud800-surrogate", "a=b", long];
  const env = Object.fromEntries(values.map((value, i) => [`KEY_${i}`, value]));
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.log(JSON.stringify([${values.map((_, i) => `process.env.KEY_${i}`)}, process.env["é日"], ...process.argv.slice(1)]))`,
      "--",
      ...values,
    ],
    env: { ...bunEnv, ...env, "é日": "key" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const wellFormed = values.map(value => value.toWellFormed());
  expect(await proc.stdout.json()).toEqual([...wellFormed, "key", ...wellFormed]);
  expect(await proc.exited).toBe(0);
});

test.each([
  [{ "A\0B": "value" }, "A\0B", "A\0B"],
  [{ A: "val\0ue" }, "A", "val\0ue"],
  [{ "日\0": "é\0" }, "日\0", "日\0"],
])("a null byte in env %j is reported with the part that holds it", (env, key, received) => {
  expect(() => spawn({ cmd: [bunExe(), "--version"], env })).toThrow(
    `The property 'options.env['${key}']' must be a string without null bytes. Received "${received}"`,
  );
});
