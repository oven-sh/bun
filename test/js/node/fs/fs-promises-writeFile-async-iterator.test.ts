import { expect, mock, test } from "bun:test";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readlinkSync, statSync } from "fs";
import { open, writeFile } from "fs/promises";
import { isLinux, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

async function outcome(run: () => unknown): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (e: any) {
    return e?.syscall ? `${e.code} ${e.syscall}` : String(e?.code ?? e);
  }
}

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

// On Linux, fsync(2) on /dev/null fails with EINVAL, so that error proves the
// call synced and reported it. A write to /dev/full fails with ENOSPC. Node
// returns for a FileHandle before its flush step.
test.skipIf(!isLinux)("fs.promises.writeFile(iterable, { flush: true }) reports a failed fsync", async () => {
  const throws = function* () {
    yield "a";
    throw "thrown";
  };
  const fd = openSync("/dev/null", "w");
  const handle = await open("/dev/null", "w");
  try {
    expect({
      path: await outcome(() => writeFile("/dev/null", ["a", "b"], { flush: true })),
      bufferPath: await outcome(() => writeFile(Buffer.from("/dev/null"), ["a", "b"], { flush: true })),
      urlPath: await outcome(() => writeFile(pathToFileURL("/dev/null"), ["a", "b"], { flush: true })),
      asyncIterable: await outcome(() =>
        writeFile(
          "/dev/null",
          (async function* () {
            yield "a";
          })(),
          { flush: true },
        ),
      ),
      rawFd: await outcome(() => writeFile(fd as any, ["a"], { flush: true })),
      fileHandle: await outcome(() => writeFile(handle, ["a"], { flush: true })),
      fileHandleMethod: await outcome(() => handle.writeFile(["a"] as any, { flush: true } as any)),
      noFlush: await outcome(() => writeFile("/dev/null", ["a"], { flush: false })),
      writeFails: await outcome(() => writeFile("/dev/full", ["a"], { flush: true })),
      iterableThrows: await outcome(() => writeFile("/dev/null", throws(), { flush: true })),
    }).toEqual({
      path: "EINVAL fsync",
      bufferPath: "EINVAL fsync",
      urlPath: "EINVAL fsync",
      asyncIterable: "EINVAL fsync",
      rawFd: "EINVAL fsync",
      fileHandle: "ok",
      fileHandleMethod: "ok",
      noFlush: "ok",
      writeFails: "ENOSPC write",
      iterableThrows: "thrown",
    });
  } finally {
    closeSync(fd);
    await handle.close();
  }

  const devNullFds = () =>
    readdirSync("/proc/self/fd").filter(fd => {
      try {
        return readlinkSync(`/proc/self/fd/${fd}`) === "/dev/null";
      } catch {
        return false;
      }
    }).length;
  const before = devNullFds();
  let failures = 0;
  for (let i = 0; i < 25; i++) {
    if ((await outcome(() => writeFile("/dev/null", ["a"], { flush: true }))) === "EINVAL fsync") failures++;
  }
  expect({ failures, leaked: Math.max(0, devNullFds() - before) }).toEqual({ failures: 25, leaked: 0 });
});

// A Buffer or URL path was written in place with no flag. And a resize after
// the write padded a file of many chunks with NUL bytes.
test("fs.promises.writeFile(iterable) truncates each kind of path and writes the exact bytes", async () => {
  using dir = tempDir("fs-promises-writeFile-iterable-paths", {
    "string.txt": "seed seed seed",
    "buffer.txt": "seed seed seed",
    "url.txt": "seed seed seed",
  });
  const targets = {
    string: join(String(dir), "string.txt"),
    buffer: Buffer.from(join(String(dir), "buffer.txt")),
    url: pathToFileURL(join(String(dir), "url.txt")),
  };
  const chunks = Array.from({ length: 500 }, () => "0123456789");
  const got: Record<string, { small: string; appended: string; manyChunks: number }> = {};
  for (const [name, target] of Object.entries(targets)) {
    const path = join(String(dir), `${name}.txt`);
    await writeFile(target, ["a", "b"]);
    const small = readFileSync(path, "utf8");
    await writeFile(target, ["c"], { flag: "a" });
    const appended = readFileSync(path, "utf8");
    await writeFile(target, chunks);
    got[name] = { small, appended, manyChunks: statSync(path).size };
  }
  const want = { small: "ab", appended: "abc", manyChunks: 5000 };
  expect(got).toEqual({ string: want, buffer: want, url: want });
});

test("fs.promises.writeFile(iterable, { flush: true }) writes a regular file", async () => {
  using dir = tempDir("fs-promises-writeFile-iterable-flush", {});
  const path = join(String(dir), "file.txt");
  await writeFile(path, ["a", "b"], { flush: true });
  await writeFile(
    path,
    (async function* () {
      yield "c";
    })(),
    { flag: "a", flush: true },
  );
  expect(readFileSync(path, "utf8")).toBe("abc");
});

test("fs.promises.writeFile(iterable) validates flush before it opens the file or reads the data", async () => {
  using dir = tempDir("fs-promises-writeFile-iterable-flush-validate", {});
  const path = join(String(dir), "file.txt");
  const iterable = { [Symbol.iterator]: mock(() => ["a"][Symbol.iterator]()) };
  for (const flush of ["yes", 1, 0, "", [], {}]) {
    await expect(writeFile(path, iterable as any, { flush } as any)).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining('The "options.flush" property must be of type boolean.'),
    });
  }
  expect({ created: existsSync(path), reads: iterable[Symbol.iterator].mock.calls.length }).toEqual({
    created: false,
    reads: 0,
  });

  await writeFile(path, ["a"], { flush: null } as any);
  await writeFile(path, ["b"], { flush: undefined });
  expect(readFileSync(path, "utf8")).toBe("b");
});

test("fs.promises.writeFile(iterable) rejects with a falsy value that the iterable throws", async () => {
  using dir = tempDir("fs-promises-writeFile-iterable-falsy", {});
  const caught: unknown[] = [];
  for (const value of [null, undefined, 0, ""]) {
    try {
      await writeFile(
        join(String(dir), "file.txt"),
        (function* () {
          yield "a";
          throw value;
        })(),
        { flush: true },
      );
      caught.push("resolved");
    } catch (e) {
      caught.push(e);
    }
  }
  expect(caught).toEqual([null, undefined, 0, ""]);
});
