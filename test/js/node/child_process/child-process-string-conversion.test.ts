/**
 * This test runs under `bun test` and (via node:test/node:assert) under `node --test`. Node is the reference for
 * every assertion here, so the same file must pass on Node. That is why it imports neither `bun:test` nor `harness`.
 *
 * What the caller's own code throws while an argument, the cwd or an env value is converted to a string is not a
 * failure of the spawn. Node throws it as it is, and keeps `result.error` for what the operating system refuses.
 * Node converts an env value before it validates the other options, and the arguments and the cwd of a sync spawn
 * when it spawns:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/child_process.js#L737
 * https://github.com/nodejs/node/blob/v26.3.0/src/spawn_sync.cc#L817-L838
 *
 * The arguments and the cwd of an async spawn are not here. Node does not throw what their conversion throws:
 * https://github.com/nodejs/node/blob/v26.3.0/src/process_wrap.cc#L259-L285
 */
import assert from "node:assert";
import { ChildProcess, exec, execFile, execFileSync, execSync, fork, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const exe = process.execPath;
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
const dir = import.meta.dirname;

type Value = [name: string, make: () => unknown];
type Entry = [name: string, call: (throws: any) => unknown];

// An errno error of another call: it has an own `errno`, a `code` and a `syscall`.
function fsError() {
  try {
    fs.readFileSync(path.join(dir, "does-not-exist"));
  } catch (error) {
    return error;
  }
  throw new Error("readFileSync did not throw");
}

// These two have the `code` of a failed spawn.
const coded: Value[] = [
  ["an fs ENOENT error", fsError],
  // What Bun.spawnSync puts on the error of a process that ran and whose output was lost.
  ["an object with errno, pid and exitCode", () => ({ errno: -2, code: "ENOENT", pid: 4242, exitCode: 7 })],
];
// Each call makes a new value: the assertions are on its identity and on its own keys.
const values: Value[] = [
  ["an Error", () => new Error("boom")],
  ["undefined", () => undefined],
  ["null", () => null],
  ["0", () => 0],
  ["a string", () => "str"],
  ["a frozen Error", () => Object.freeze(new Error("frozen"))],
  ...coded,
];

function outcome(call: () => unknown): { threw: boolean; value: any } {
  let value: unknown;
  try {
    value = call();
  } catch (thrown) {
    return { threw: true, value: thrown };
  }
  // A child that came back where a throw was expected: its 'error' must not end the run.
  if (value instanceof ChildProcess) {
    value.on("error", () => {});
    value.kill();
  }
  return { threw: false, value };
}

const ownKeys = (value: unknown) => (typeof value === "object" && value !== null ? Reflect.ownKeys(value) : null);
const envWith = (value: unknown): any => ({ ...env, THROWS: value });
// A Buffer is a valid cwd. This one has its own conversion.
const cwdWith = (toString: () => string): any => Object.assign(Buffer.from(dir), { toString });

function thrownAsItIs(call: Entry[1], make: Value[1]) {
  const value = make();
  const keys = ownKeys(value);
  let conversions = 0;
  const result = outcome(() =>
    call({
      toString() {
        conversions++;
        throw value;
      },
    }),
  );
  assert.deepStrictEqual(
    { threw: result.threw, same: Object.is(result.value, value), keys: ownKeys(value), conversions },
    { threw: true, same: true, keys, conversions: 1 },
  );
}

describe("what the conversion to a string throws is thrown as it is", () => {
  const sync: Entry[] = [
    ["spawnSync: an argument", throws => spawnSync(exe, ["-e", throws])],
    ["spawnSync: an env value", throws => spawnSync(exe, ["-e", "0"], { env: envWith(throws) })],
    ["spawnSync: a Buffer cwd", throws => spawnSync(exe, ["-e", "0"], { cwd: cwdWith(throws.toString) })],
    ["execFileSync: an argument", throws => execFileSync(exe, ["-e", throws])],
    ["execFileSync: an env value", throws => execFileSync(exe, ["-e", "0"], { env: envWith(throws) })],
    ["execFileSync: a Buffer cwd", throws => execFileSync(exe, ["-e", "0"], { cwd: cwdWith(throws.toString) })],
    ["execSync: an env value", throws => execSync("exit 0", { env: envWith(throws) })],
    ["execSync: a Buffer cwd", throws => execSync("exit 0", { cwd: cwdWith(throws.toString) })],
  ];
  for (const [entry, call] of sync) {
    describe(entry, () => {
      for (const [name, make] of values) test(name, () => thrownAsItIs(call, make));
    });
  }

  const async: Entry[] = [
    ["spawn: an env value", throws => spawn(exe, ["-e", "0"], { env: envWith(throws) })],
    ["execFile: an env value", throws => execFile(exe, ["-e", "0"], { env: envWith(throws) }, () => {})],
    ["exec: an env value", throws => exec("exit 0", { env: envWith(throws) }, () => {})],
    [
      "fork: an env value",
      throws => fork(path.join(dir, "spawned-child.js"), [], { execPath: exe, env: envWith(throws) }),
    ],
  ];
  for (const [entry, call] of async) {
    describe(entry, () => {
      for (const [name, make] of coded) test(name, () => thrownAsItIs(call, make));
    });
  }

  const symbols: [name: string, call: () => unknown][] = [
    ["spawnSync: an argument", () => spawnSync(exe, ["-e", Symbol("x") as any])],
    ["spawnSync: an env value", () => spawnSync(exe, ["-e", "0"], { env: envWith(Symbol("x")) })],
    ["execFileSync: an argument", () => execFileSync(exe, ["-e", Symbol("x") as any])],
    ["execSync: an env value", () => execSync("exit 0", { env: envWith(Symbol("x")) })],
  ];
  for (const [entry, call] of symbols) {
    test(`${entry} that is a Symbol throws a TypeError`, () => {
      const { threw, value } = outcome(call);
      assert.deepStrictEqual(
        { threw, name: threw && value.name, syscall: threw && "syscall" in value },
        { threw: true, name: "TypeError", syscall: false },
      );
    });
  }
});

describe("the order of the conversions", () => {
  const conversions: string[] = [];
  const arg = (name: string, thrown?: Error): any => ({
    toString() {
      conversions.push(name);
      if (thrown) throw thrown;
      return name;
    },
  });
  const cwd = () =>
    cwdWith(() => {
      conversions.push("cwd");
      return dir;
    });

  test("an env value is converted before the options that follow it are validated", () => {
    const value = new Error("env");
    const options = {
      env: envWith({
        toString() {
          throw value;
        },
      }),
      timeout: NaN,
    };
    const sync = outcome(() => spawnSync(exe, [], options));
    assert.deepStrictEqual({ threw: sync.threw, same: sync.value === value }, { threw: true, same: true });
    const async = outcome(() => spawn(exe, [], options));
    assert.deepStrictEqual({ threw: async.threw, same: async.value === value }, { threw: true, same: true });
  });

  test("an argument and the cwd are converted after the options are validated", () => {
    conversions.length = 0;
    const { threw, value } = outcome(() => spawnSync(exe, [arg("a")], { cwd: cwd(), timeout: NaN }));
    assert.deepStrictEqual(
      { threw, code: value?.code, conversions },
      { threw: true, code: "ERR_OUT_OF_RANGE", conversions: [] },
    );
  });

  test("each argument is converted once, then the cwd, before a command that is not in PATH is reported", () => {
    conversions.length = 0;
    const { error } = spawnSync("does-not-exist", [arg("a"), arg("b")], { cwd: cwd() });
    assert.deepStrictEqual(
      { code: (error as NodeJS.ErrnoException | undefined)?.code, conversions },
      { code: "ENOENT", conversions: ["a", "b", "cwd"] },
    );

    conversions.length = 0;
    const boom = new Error("boom");
    const { threw, value } = outcome(() =>
      spawnSync("does-not-exist", [arg("a"), arg("b", boom), arg("c")], { cwd: cwd() }),
    );
    assert.deepStrictEqual(
      { threw, same: value === boom, conversions },
      { threw: true, same: true, conversions: ["a", "b"] },
    );
  });

  // node refuses a batch file before it converts an argument: https://github.com/nodejs/node/blob/v26.3.0/src/spawn_sync.cc#L812-L820
  test(
    "a Windows batch file is refused before an argument is converted",
    { skip: process.platform !== "win32" },
    () => {
      conversions.length = 0;
      const { error } = spawnSync("does-not-exist.cmd", [arg("a", new Error("boom"))]);
      assert.deepStrictEqual(
        { code: (error as NodeJS.ErrnoException | undefined)?.code, conversions },
        { code: "EINVAL", conversions: [] },
      );
    },
  );
});

test("an argument, a Buffer cwd and an env value that are not strings reach the child as node converts them", async () => {
  const object = {
    toString() {
      return "two";
    },
  };
  const script = `
    const fs = require("fs");
    const here = fs.realpathSync(process.cwd()) === fs.realpathSync(process.env.DIR);
    console.log(JSON.stringify([process.argv.slice(1), process.env.N, process.env.O, here]));
  `;
  const args: any[] = ["-e", script, 1, object, null, undefined, true, 10n];
  const options: any = {
    env: { ...env, N: 1, O: object, DIR: dir },
    cwd: Buffer.from(dir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  };
  const expected = JSON.stringify([["1", "two", "null", "undefined", "true", "10"], "1", "two", true]) + "\n";

  assert.strictEqual(spawnSync(exe, args, options).stdout, expected);
  assert.strictEqual(execFileSync(exe, args, options), expected);

  // node's spawn() ignores a cwd that is not a string, so this one has none.
  const spawned = spawn(exe, args, { env: { ...options.env, DIR: process.cwd() }, stdio: options.stdio });
  let stdout = "";
  spawned.stdout!.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  const [code] = await once(spawned, "close");
  assert.deepStrictEqual({ stdout, code }, { stdout: expected, code: 0 });
});

describe("what the operating system refuses is still in result.error", () => {
  const missing = path.join(dir, "does-not-exist");
  // Windows has other errors for these two: no mode says that a file is not executable, and a bad fd is a libuv error.
  const posix = { skip: process.platform === "win32" };

  function refused(file: string, options: object, code: string) {
    // `spawnargs` keeps the number that the caller passed, not the string that the spawn gets.
    const { error, ...result } = spawnSync(file, ["-e", 0 as any], options);
    const failure = error as (NodeJS.ErrnoException & { spawnargs?: unknown[] }) | undefined;
    assert.deepStrictEqual(
      {
        ...result,
        code: failure?.code,
        errno: typeof failure?.errno,
        syscall: failure?.syscall,
        spawnargs: failure?.spawnargs,
      },
      {
        status: null,
        signal: null,
        output: null,
        pid: 0,
        // node reads these two from `output` with `?.`: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L1123-L1124
        stdout: undefined,
        stderr: undefined,
        code,
        errno: "number",
        syscall: "spawnSync " + file,
        spawnargs: ["-e", 0],
      },
    );
  }

  test("a command that is not in PATH", () => refused("does-not-exist", {}, "ENOENT"));
  test("a file that does not exist", () => refused(missing, {}, "ENOENT"));
  test("a cwd that does not exist", () => refused(exe, { cwd: Buffer.from(missing) }, "ENOENT"));
  test("a file that is not executable", posix, () => refused(import.meta.filename, {}, "EACCES"));
  test("an fd that is not open", posix, () => {
    // An fd that is open in this process is inherited, and then the child runs.
    assert.throws(() => fs.fstatSync(10240), { code: "EBADF" });
    refused(exe, { stdio: ["ignore", "ignore", "ignore", 10240] }, "EBADF");
  });
});
