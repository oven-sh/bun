import { describe, expect, mock, test } from "bun:test";
import { existsSync } from "fs";
import { appendFile, open, readFile, writeFile } from "fs/promises";
import { bunEnv, bunExe, isGlibc, isLinux, tempDir } from "harness";
import { devNull } from "os";
import { join } from "path";
test("fs.promises.writeFile async iterator", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const path = dir + "/file2.txt";

  const stream = async function* () {
    yield "1 ";
    yield "Hello, ";
    yield "world!";
  };

  await writeFile(path, stream());
  expect(await Bun.file(path).text()).toBe("1 Hello, world!");

  const bufStream = async function* () {
    yield Buffer.from("2 ");
    yield Buffer.from("Hello, ");
    yield Buffer.from("world!");
  };

  await writeFile(path, bufStream());

  expect(await Bun.file(path).text()).toBe("2 Hello, world!");
});

test("fs.promises.writeFile async iterator throws on invalid input", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const symbolStream = async function* () {
    yield Symbol("lolwhat");
  };

  expect(() => writeFile(dir + "/file2.txt", symbolStream())).toThrow();
  expect(() =>
    writeFile(
      dir + "/file3.txt",
      (async function* () {
        yield "once";
        throw new Error("good");
      })(),
    ),
  ).toThrow("good");
  const fn = {
    [Symbol.asyncIterator]: mock(() => {}),
  };
  expect(() => writeFile(String(dir), fn)).toThrow();
  expect(fn[Symbol.asyncIterator]).not.toBeCalled();
});

// Node validates `options.flush` for every kind of data and, when it is true,
// fsyncs the file it opened for a path; Bun's (async) iterable path used to
// ignore the option entirely.
describe("fs.promises.writeFile async iterator: options.flush", () => {
  const invalidMessage = (received: string) =>
    `ERR_INVALID_ARG_TYPE: The "options.flush" property must be of type boolean. Received ${received}`;

  test.concurrent("rejects a non-boolean flush before opening the file or reading the iterable", async () => {
    await using dir = tempDir("writeFile-iterable-flush-type", {});
    const results: string[] = [];
    for (const flush of ["yes", 1, 0, "", [], {}]) {
      let pulled = false;
      const iterable = {
        *[Symbol.iterator]() {
          pulled = true;
          yield "x";
        },
      };
      const path = join(String(dir), `${results.length}.txt`);
      const err = await writeFile(path, iterable, { flush } as any).then(
        () => null,
        e => e,
      );
      results.push(`${err?.code}: ${err?.message} | pulled=${pulled} | created=${existsSync(path)}`);
    }
    expect(results).toEqual(
      [
        "type string ('yes')",
        "type number (1)",
        "type number (0)",
        "type string ('')",
        "an instance of Array",
        "an instance of Object",
      ].map(received => `${invalidMessage(received)} | pulled=false | created=false`),
    );
  });

  test.concurrent("validates flush on every FileHandle entry point", async () => {
    await using dir = tempDir("writeFile-iterable-flush-type-fh", { "a.txt": "" });
    const file = join(String(dir), "a.txt");
    const fh = await open(file, "w");
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => "resolved",
        e => `${e.code}: ${e.message}`,
      );
    try {
      const bad = { flush: "yes" } as any;
      const results = {
        "writeFile(handle, iterable)": await outcome(writeFile(fh, ["x"], bad)),
        "writeFile(handle, string)": await outcome(writeFile(fh, "x", bad)),
        "appendFile(handle, string)": await outcome(appendFile(fh, "x", bad)),
        "handle.writeFile(iterable)": await outcome(fh.writeFile(["x"] as any, bad)),
        "handle.writeFile(string)": await outcome(fh.writeFile("x", bad)),
        "handle.appendFile(iterable)": await outcome(fh.appendFile(["x"] as any, bad)),
        "handle.appendFile(string)": await outcome(fh.appendFile("x", bad)),
      };
      const rejected = invalidMessage("type string ('yes')");
      expect(results).toEqual({
        "writeFile(handle, iterable)": rejected,
        "writeFile(handle, string)": rejected,
        "appendFile(handle, string)": rejected,
        "handle.writeFile(iterable)": rejected,
        "handle.writeFile(string)": rejected,
        "handle.appendFile(iterable)": rejected,
        "handle.appendFile(string)": rejected,
      });
    } finally {
      await fh.close();
    }
    expect(await readFile(file, "utf8")).toBe("");
  });

  test.concurrent("accepts every flush value node accepts", async () => {
    await using dir = tempDir("writeFile-iterable-flush-values", {});
    const results: Record<string, string> = {};
    for (const flush of [undefined, null, false, true]) {
      const path = join(String(dir), `${String(flush)}.txt`);
      await writeFile(path, ["a", "b"], { flush } as any);
      results[String(flush)] = await readFile(path, "utf8");
    }
    expect(results).toEqual({ undefined: "ab", null: "ab", false: "ab", true: "ab" });
  });

  test.concurrent("rejects with whatever the iterable threw, even a falsy value", async () => {
    await using dir = tempDir("writeFile-iterable-flush-falsy-throw", {});
    const results: unknown[] = [];
    for (const thrown of [0, null, undefined, false, ""]) {
      function* failing() {
        yield "p";
        throw thrown;
      }
      const path = join(String(dir), `${results.length}.txt`);
      results.push(
        await writeFile(path, failing(), { flush: true }).then(
          () => "resolved",
          rejectedWith => ({ rejectedWith }),
        ),
      );
    }
    expect(results).toEqual([
      { rejectedWith: 0 },
      { rejectedWith: null },
      { rejectedWith: undefined },
      { rejectedWith: false },
      { rejectedWith: "" },
    ]);
  });

  // /dev/null cannot be fsynced (EINVAL), which makes it observable whether a
  // sync was attempted: node syncs a path it opened itself and never syncs a
  // caller's FileHandle. fsync's errno on other platforms is not pinned down.
  test.skipIf(!isLinux)("syncs a path it opened, not a caller's FileHandle, like node", async () => {
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => "resolved",
        e => `${e.code} from ${e.syscall}`,
      );
    const fh = await open(devNull, "w");
    let results;
    try {
      results = {
        "writeFile(handle, iterable)": await outcome(writeFile(fh, ["x"], { flush: true })),
        "handle.writeFile(iterable)": await outcome(fh.writeFile(["x"] as any, { flush: true } as any)),
        "handle.appendFile(iterable)": await outcome(fh.appendFile(["x"] as any, { flush: true } as any)),
        "writeFile(path, iterable)": await outcome(writeFile(devNull, ["x"], { flush: true })),
        "writeFile(path, iterable) without flush": await outcome(writeFile(devNull, ["x"])),
      };
    } finally {
      await fh.close();
    }
    expect(results).toEqual({
      "writeFile(handle, iterable)": "resolved",
      "handle.writeFile(iterable)": "resolved",
      "handle.appendFile(iterable)": "resolved",
      "writeFile(path, iterable)": "EINVAL from fsync",
      "writeFile(path, iterable) without flush": "resolved",
    });
  });

  // Buffer and URL paths used to skip fs.open and hand the path straight to
  // Bun.file().writer(), so flag/mode were ignored, the old tail of the file
  // survived and there was no descriptor to fsync. Runs in a child process:
  // the old Bun.file(buffer) route trips a debug-only GC assertion, which
  // would otherwise take the whole test runner down instead of failing here.
  test.concurrent("string, Buffer and URL paths all go through open(flag) and honor flush", async () => {
    await using dir = tempDir("writeFile-iterable-flush-paths", {
      "string.txt": "seed seed seed",
      "buffer.txt": "seed seed seed",
      "url.txt": "seed seed seed",
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = ${JSON.stringify(String(dir))};
const targets = {
  string: join(dir, "string.txt"),
  buffer: Buffer.from(join(dir, "buffer.txt")),
  url: pathToFileURL(join(dir, "url.txt")),
};
const results = {};
for (const [kind, target] of Object.entries(targets)) {
  await writeFile(target, ["a", "b"], { flush: true });
  const truncated = await readFile(target, "utf8");
  await writeFile(target, ["c"], { flag: "a", flush: true });
  results[kind] = [truncated, await readFile(target, "utf8")];
}
console.log(JSON.stringify(results));
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ results: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      results: {
        string: ["ab", "abc"],
        buffer: ["ab", "abc"],
        url: ["ab", "abc"],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // The fsync itself is issued from native code, so observe it by interposing
  // fsync(2) with an LD_PRELOAD shim. Every call appends one byte to
  // $FSYNC_LOG; with $FSYNC_FAIL set it also fails with EIO instead of syncing.
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  describe.skipIf(!isGlibc || !cc)("fsync(2)", () => {
    const shimSource = `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>
int fsync(int fd) {
  const char *log = getenv("FSYNC_LOG");
  if (log) {
    int logfd = open(log, O_WRONLY | O_APPEND | O_CREAT, 0644);
    if (logfd >= 0) {
      write(logfd, "x", 1);
      close(logfd);
    }
  }
  if (getenv("FSYNC_FAIL")) {
    errno = EIO;
    return -1;
  }
  return ((int (*)(int))dlsym(RTLD_NEXT, "fsync"))(fd);
}
`;
    // Shared by both fixtures: section() runs one operation and records how many
    // fsync(2) calls it made plus what it resolved or rejected with.
    const fixturePrelude = `
import fs from "node:fs";
import fsp from "node:fs/promises";
import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const file = name => dir + "/" + name + ".txt";
const fsyncs = () => (fs.existsSync(process.env.FSYNC_LOG) ? fs.statSync(process.env.FSYNC_LOG).size : 0);
const report = {};
const describeError = err =>
  err instanceof Error ? (err.syscall ? err.code + " from " + err.syscall : err.code ?? err.message) : "rejected with " + err;
async function section(name, run) {
  const before = fsyncs();
  const result = await run().then(value => value ?? "resolved", describeError);
  report[name] = { fsyncs: fsyncs() - before, result };
}
const contents = name => fs.readFileSync(file(name), "utf8");
function* failingWith(thrown) {
  yield "1";
  throw thrown;
}
const failing = () => failingWith(new Error("boom"));
`;

    async function runFixture(dir: string, extraEnv: Record<string, string>) {
      const shim = join(dir, "shim.so");
      await using ccProc = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(dir, "shim.c"), "-ldl"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [ccErr, ccExit] = await Promise.all([ccProc.stderr.text(), ccProc.exited]);
      if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr}`);

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(dir, "fixture.mjs"), dir],
        env: {
          ...bunEnv,
          LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim,
          FSYNC_LOG: join(dir, "fsync.log"),
          ...extraEnv,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    }

    test.concurrent("is called once after the data is written, only when flush is true", async () => {
      await using dir = tempDir("writeFile-iterable-fsync-count", {
        "shim.c": shimSource,
        "fixture.mjs": `${fixturePrelude}
await section("no options", () => fsp.writeFile(file("a"), ["1", "2"]));
await section("flush: false", () => fsp.writeFile(file("b"), ["1", "2"], { flush: false }));
await section("string path", () => fsp.writeFile(file("c"), ["1", "2"], { flush: true }).then(() => contents("c")));
await section("URL path", () => fsp.writeFile(pathToFileURL(file("d")), ["1", "2"], { flush: true }).then(() => contents("d")));
await section("Buffer path", () => fsp.writeFile(Buffer.from(file("e")), ["1", "2"], { flush: true }).then(() => contents("e")));
await section("async iterable", () => fsp.writeFile(file("f"), (async function* () { yield "1"; yield "2"; })(), { flush: true }).then(() => contents("f")));
// Each FileHandle case opens its own file (pre-filled with "0" when appending),
// runs the write with the handle, closes it and reports the file's contents.
const withHandle = (name, flag, write) => section(name, async () => {
  if (flag === "a") fs.writeFileSync(file(name), "0");
  const fh = await fsp.open(file(name), flag);
  try {
    await write(fh);
  } finally {
    await fh.close();
  }
  return contents(name);
});
await withHandle("writeFile(handle, iterable)", "w", fh => fsp.writeFile(fh, ["1", "2"], { flush: true }));
await withHandle("writeFile(handle, string)", "w", fh => fsp.writeFile(fh, "12", { flush: true }));
await withHandle("appendFile(handle, string)", "a", fh => fsp.appendFile(fh, "12", { flush: true }));
await withHandle("handle.writeFile(iterable)", "w", fh => fh.writeFile(["1", "2"], { flush: true }));
await withHandle("handle.writeFile(string)", "w", fh => fh.writeFile("12", { flush: true }));
await withHandle("handle.appendFile(iterable)", "a", fh => fh.appendFile(["1", "2"], { flush: true }));
await withHandle("handle.appendFile(string)", "a", fh => fh.appendFile("12", { flush: true }));
await section("iterable throws", () => fsp.writeFile(file("i"), failing(), { flush: true }));
await section("iterable throws undefined", () => fsp.writeFile(file("j"), failingWith(undefined), { flush: true }));
// Controls for the native binding, which this file does not change: a path and
// (through the callback-style API, where node syncs the caller's fd too) a bare fd.
await section("native: string path", () => fsp.writeFile(file("k"), "12", { flush: true }).then(() => contents("k")));
await section("native: writeFileSync(fd)", async () => {
  const fd = fs.openSync(file("l"), "w");
  try {
    fs.writeFileSync(fd, "12", { flush: true });
  } finally {
    fs.closeSync(fd);
  }
  return contents("l");
});
console.log(JSON.stringify(report));
`,
      });

      expect(await runFixture(String(dir), {})).toEqual({
        "no options": { fsyncs: 0, result: "resolved" },
        "flush: false": { fsyncs: 0, result: "resolved" },
        "string path": { fsyncs: 1, result: "12" },
        "URL path": { fsyncs: 1, result: "12" },
        "Buffer path": { fsyncs: 1, result: "12" },
        "async iterable": { fsyncs: 1, result: "12" },
        // Node validates flush for a FileHandle but never syncs one, whatever the data is.
        "writeFile(handle, iterable)": { fsyncs: 0, result: "12" },
        "writeFile(handle, string)": { fsyncs: 0, result: "12" },
        "appendFile(handle, string)": { fsyncs: 0, result: "012" },
        "handle.writeFile(iterable)": { fsyncs: 0, result: "12" },
        "handle.writeFile(string)": { fsyncs: 0, result: "12" },
        "handle.appendFile(iterable)": { fsyncs: 0, result: "012" },
        "handle.appendFile(string)": { fsyncs: 0, result: "012" },
        "iterable throws": { fsyncs: 0, result: "boom" },
        "iterable throws undefined": { fsyncs: 0, result: "rejected with undefined" },
        "native: string path": { fsyncs: 1, result: "12" },
        "native: writeFileSync(fd)": { fsyncs: 1, result: "12" },
      });
    });

    test.concurrent("failure rejects the promise; the descriptor is closed on every error path", async () => {
      await using dir = tempDir("writeFile-iterable-fsync-fail", {
        "shim.c": shimSource,
        "fixture.mjs": `${fixturePrelude}
// Warm up the code path so lazily created internal descriptors don't show up
// in the leak checks below.
await fsp.writeFile(file("warmup"), ["1"], { flush: false });
const openFds = () => fs.readdirSync("/proc/self/fd").length;
const fdsBefore = openFds();
const leakCheck = name => {
  report[name].leakedFds = openFds() - fdsBefore;
};
await section("fsync fails", () => fsp.writeFile(file("a"), ["1", "2"], { flush: true }));
report["fsync fails"].contents = contents("a");
leakCheck("fsync fails");
await section("flush: false never reaches fsync", () => fsp.writeFile(file("b"), ["1", "2"], { flush: false }));
await section("iterable throws", () => fsp.writeFile(file("c"), failing(), { flush: true }));
leakCheck("iterable throws");
await section("iterable throws null", () => fsp.writeFile(file("d"), failingWith(null), { flush: true }));
leakCheck("iterable throws null");
await section("FileHandle", async () => {
  const fh = await fsp.open(file("e"), "w");
  try {
    const result = await fsp.writeFile(fh, ["1", "2"], { flush: true }).then(() => "resolved", describeError);
    // writeFile must not close a descriptor it did not open.
    return result + ", handle still has " + (await fh.stat()).size + " bytes";
  } finally {
    await fh.close();
  }
});
console.log(JSON.stringify(report));
`,
      });

      expect(await runFixture(String(dir), { FSYNC_FAIL: "1" })).toEqual({
        "fsync fails": { fsyncs: 1, result: "EIO from fsync", contents: "12", leakedFds: 0 },
        "flush: false never reaches fsync": { fsyncs: 0, result: "resolved" },
        "iterable throws": { fsyncs: 0, result: "boom", leakedFds: 0 },
        "iterable throws null": { fsyncs: 0, result: "rejected with null", leakedFds: 0 },
        "FileHandle": { fsyncs: 0, result: "resolved, handle still has 2 bytes" },
      });
    });
  });
});
