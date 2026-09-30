import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, tempDir } from "harness";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";

// oven-sh/WebKit#556. The Linux kernel lets the main thread's stack mapping reach RLIMIT_STACK, measured from the
// end of the mapping. The argument and environment strings are at that end. A bound measured from below them is too
// low by their size. Once they pass the reserve that a recursion check keeps, the kernel's limit comes first and
// the process gets SIGSEGV. The largest reserve is 512 KB (bun's checks in an ASAN build).
//
// Linux only. Windows and macOS give bun an 18 MB main stack at link time and do not measure it this way. Windows
// caps a variable at 32,767 characters, and macOS caps the arguments plus the environment at 1 MB.

// The kernel caps one string at 128 KB (MAX_ARG_STRLEN), so the 700 KB is seven variables.
const largeEnvironment = {
  ...bunEnv,
  ...Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [`STACK_BOUNDS_PADDING_${i}`, Buffer.alloc(100_000, "x").toString()]),
  ),
};

// CI runs with an unlimited stack, where the kernel has no limit to come first. The limit must stay above four times
// the environment, or exec fails with E2BIG.
function withStackLimit(kilobytes: number, cmd: string[]) {
  return ["sh", "-c", `ulimit -S -s ${kilobytes} && exec "$0" "$@"`, ...cmd];
}

// The soft limit cannot go above the hard limit, which /proc/self/limits gives in bytes after the soft limit.
const hardStackLimit = isLinux
  ? /^Max stack size\s+\S+\s+(\S+)/m.exec(readFileSync("/proc/self/limits", "utf8"))?.[1]
  : "";
const canSetStackLimit = hardStackLimit === "unlimited" || Number(hardStackLimit) >= 8192 * 1024;

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: largeEnvironment, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

// The dynamic loader that an ELF file names in PT_INTERP, or undefined for a static executable.
function programInterpreter(path: string): string | undefined {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(64);
    readSync(fd, header, 0, header.length, 0);
    const entrySize = header.readUInt16LE(0x36);
    const table = Buffer.alloc(entrySize * header.readUInt16LE(0x38));
    readSync(fd, table, 0, table.length, Number(header.readBigUInt64LE(0x20)));
    for (let at = 0; at < table.length; at += entrySize) {
      const PT_INTERP = 3;
      if (table.readUInt32LE(at) !== PT_INTERP) continue;
      const name = Buffer.alloc(Number(table.readBigUInt64LE(at + 0x20)));
      readSync(fd, name, 0, name.length, Number(table.readBigUInt64LE(at + 0x08)));
      return name.toString("latin1", 0, name.indexOf(0));
    }
  } finally {
    closeSync(fd);
  }
}

describe.concurrent.skipIf(!isLinux || !canSetStackLimit)("with 700 KB of environment", () => {
  test("native recursion checks trip before the stack ends", async () => {
    const script = `
      const open = Buffer.alloc(100_000, "[").toString();
      const close = Buffer.alloc(100_000, "]").toString();
      const walkers = {
        "Bun.JSONC.parse": () => Bun.JSONC.parse(open + close),
        "Bun.JSON5.parse": () => Bun.JSON5.parse(open + close),
        "Bun.TOML.parse": () => Bun.TOML.parse("a = " + open + close),
        "Bun.YAML.parse": () => Bun.YAML.parse(open + close),
        "Bun.Transpiler": () => new Bun.Transpiler().transformSync("x = " + open + close),
      };
      for (const [name, walk] of Object.entries(walkers)) {
        try {
          walk();
          console.log(name + ": no error");
        } catch (e) {
          console.log(name + ": " + e.message);
        }
      }
    `;
    const { stdout, ...rest } = await run(withStackLimit(8192, [bunExe(), "-e", script]));
    expect({ stdout: stdout.split("\n"), ...rest }).toEqual({
      stdout: [
        "Bun.JSONC.parse: Maximum call stack size exceeded.",
        "Bun.JSON5.parse: Maximum call stack size exceeded.",
        "Bun.TOML.parse: Maximum call stack size exceeded.",
        "Bun.YAML.parse: Maximum call stack size exceeded.",
        "Bun.Transpiler: Maximum call stack size exceeded",
        "",
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // The define loader runs before the VM exists, on the bound that the main thread computes at start.
  const deepDefine = () =>
    tempDir("stack-bounds-define", {
      "bunfig.toml": `[define]\nK = '${Buffer.alloc(40_000, "[")}1${Buffer.alloc(40_000, "]")}'\n`,
      "index.js": `console.log("ran");`,
    });
  const deepDefineError = {
    stdout: "",
    // The column is the depth that the parser reached, which is not the same in every build.
    stderr: expect.stringMatching(
      /^1 \| \[+\n +\^\nerror: JSON document is too deeply nested\n    at defines\.json:1:\d+\n$/,
    ),
    exitCode: 1,
    signalCode: null,
  };

  test("a deeply nested [define] value is an error", async () => {
    using dir = deepDefine();
    expect(await run(withStackLimit(8192, [bunExe(), "index.js"]), String(dir))).toEqual(deepDefineError);
  });

  // glibc's loader points AT_EXECFN, which marks the end of the stack mapping, at argv[0].
  const loader = isLinux ? programInterpreter(bunExe()) : undefined;
  test.skipIf(!loader)("a deeply nested [define] value is an error when the loader starts bun", async () => {
    using dir = deepDefine();
    expect(await run(withStackLimit(8192, [loader!, bunExe(), "index.js"]), String(dir))).toEqual(deepDefineError);
  });

  // The RegExp parser checks the stack against JavaScriptCore's copy of the bound. A debug JavaScriptCore takes
  // 0.2 ms for each group, so it gets fewer groups and a limit that fewer groups reach.
  test("a deeply nested RegExp is a RangeError", async () => {
    const [limit, groups] = isDebug ? [4096, 3_000] : [8192, 60_000];
    const script = `
      const open = Buffer.alloc(${groups * 3}, "(?:").toString();
      const close = Buffer.alloc(${groups}, ")").toString();
      try {
        new RegExp(open + "a" + close);
        console.log("no error");
      } catch (e) {
        console.log(e.constructor.name + ": " + e.message);
      }
    `;
    expect(await run(withStackLimit(limit, [bunExe(), "-e", script]))).toEqual({
      stdout: "RangeError: Out of memory: Invalid regular expression: too many nested disjunctions\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // JavaScriptCore keeps its own use of the stack under 5 MB, so its limit comes from the bound only when
  // RLIMIT_STACK is about that or lower.
  test("JS recursion is a RangeError under a 5 MB stack limit", async () => {
    const script = `
      function recurse() {
        return recurse() + 1;
      }
      try {
        recurse();
        console.log("no error");
      } catch (e) {
        console.log(e.constructor.name + ": " + e.message);
      }
    `;
    expect(await run(withStackLimit(5120, [bunExe(), "-e", script]))).toEqual({
      stdout: "RangeError: Maximum call stack size exceeded.\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
