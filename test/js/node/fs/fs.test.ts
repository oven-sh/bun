import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import {
  bunEnv,
  bunExe,
  gc,
  getMaxFD,
  isBroken,
  isDebug,
  isIntelMacOS,
  isLinux,
  isPosix,
  isWindows,
  tempDir,
  tempDirWithFiles,
  tmpdirSync,
} from "harness";
import { isAscii } from "node:buffer";
import fs, {
  closeSync,
  constants,
  copyFileSync,
  createReadStream,
  createWriteStream,
  Dir,
  Dirent,
  existsSync,
  fdatasync,
  fdatasyncSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  openAsBlob,
  openSync,
  promises,
  readdirSync,
  readFile,
  readFileSync,
  readlinkSync,
  readSync,
  readvSync,
  realpathSync,
  renameSync,
  rmdir,
  rmdirSync,
  rmSync,
  statfsSync,
  Stats,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
  writevSync,
} from "node:fs";
import * as os from "node:os";
import path, { dirname, relative, resolve } from "node:path";
import { inspect, promisify } from "node:util";

import _promises, { type FileHandle } from "node:fs/promises";

import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnSync } from "bun";
import { mkfifo } from "mkfifo";
import { ReadStream as ReadStream_, WriteStream as WriteStream_ } from "./export-from.js";
import { ReadStream as ReadStreamStar_, WriteStream as WriteStreamStar_ } from "./export-star-from.js";

const Buffer = globalThis.Buffer || Uint8Array;

if (!import.meta.dir) {
  //@ts-expect-error
  import.meta.dir = ".";
}

function mkdirForce(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function tmpdirTestMkdir(): string {
  const now = Date.now().toString() + Math.random().toString(16).slice(2, 10);
  const tempdir = `${tmpdir()}/fs.test.ts/${now}/1234/hi`;
  expect(existsSync(tempdir), `tempdir ${tempdir} should not exist`).toBe(false);
  const res = mkdirSync(tempdir, { recursive: true });
  if (!res?.includes(now)) {
    expect(res).toInclude("fs.test.ts");
  }
  // res is the first directory created (the ${now} segment). Check the last
  // path segment rather than a "1234" substring, which can occur in Date.now().
  expect(path.basename(res!)).not.toBe("1234");
  expect(path.basename(res!)).not.toBe("hi");
  expect(existsSync(tempdir)).toBe(true);
  return tempdir;
}

it("fs.statSync keeps a Uint8Array path's ArrayBuffer attached while reading options", () => {
  using dir = tempDir("fs-statsync-typed-array-path", { "target.txt": "bun" });
  const encoded = new TextEncoder().encode(join(String(dir), "target.txt"));
  const pathBuffer = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const arrayBuffer = pathBuffer.buffer as ArrayBuffer;
  const stats = statSync(pathBuffer, {
    get throwIfNoEntry() {
      arrayBuffer.transfer();
      return true;
    },
  });
  expect(arrayBuffer.detached).toBe(false);
  expect(stats!.isFile()).toBe(true);
  arrayBuffer.transfer();
  expect(arrayBuffer.detached).toBe(true);
});

it.skipIf(isWindows)("fs.chmodSync applies mode bits above 0o777", () => {
  using dir = tempDir("fs-chmod-special-bits", {});
  const dirPath = join(String(dir), "subdir");
  mkdirSync(dirPath);
  fs.chmodSync(dirPath, 0o1777);
  expect(statSync(dirPath).mode & 0o7777).toBe(0o1777);
  fs.chmodSync(dirPath, "1755");
  expect(statSync(dirPath).mode & 0o7777).toBe(0o1755);
});

it.concurrent("fs.writeFile(1, data) should work when its inherited", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fs-writeFile-1-fixture.js"), "1"],
    env: bunEnv,
    stdio: ["inherit", "pipe", "inherit"],
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  if (exitCode !== 0) throw new Error("Command failed:\n" + stdout);
  expect(exitCode).toBe(0);
});

it.concurrent("fs.writeFile(2, data) should work when its inherited", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fs-writeFile-1-fixture.js"), "2"],
    env: bunEnv,
    stdio: ["inherit", "pipe", "inherit"],
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  if (exitCode !== 0) throw new Error("Command failed:\n" + stdout);
  expect(exitCode).toBe(0);
});

it.concurrent("fs.writeFile(/dev/null, data) should work", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fs-writeFile-1-fixture.js"), os.devNull],
    env: bunEnv,
    stdio: ["inherit", "pipe", "inherit"],
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  if (exitCode !== 0) throw new Error("Command failed:\n" + stdout);
  expect(exitCode).toBe(0);
});

it("fs.openAsBlob", async () => {
  expect((await openAsBlob(import.meta.path)).size).toBe(statSync(import.meta.path).size);
});

it("writing to 1, 2 are possible", () => {
  expect(fs.writeSync(1, Buffer.from("\nhello-stdout-test\n"))).toBe(19);
  expect(fs.writeSync(2, Buffer.from("\nhello-stderr-test\n"))).toBe(19);
});

describe("test-fs-assert-encoding-error", () => {
  const testPath = join(tmpdirSync(), "assert-encoding-error");
  const options = "test";
  const expectedError = expect.objectContaining({
    code: "ERR_INVALID_ARG_VALUE",
    name: "TypeError",
  });

  it("readFile throws on invalid encoding", () => {
    expect(() => {
      fs.readFile(testPath, options, () => {});
    }).toThrow(expectedError);
  });

  it("readFileSync throws on invalid encoding", () => {
    expect(() => {
      fs.readFileSync(testPath, options);
    }).toThrow(expectedError);
  });

  it("readdir throws on invalid encoding", () => {
    expect(() => {
      fs.readdir(testPath, options, () => {});
    }).toThrow(expectedError);
  });

  it("readdirSync throws on invalid encoding", () => {
    expect(() => {
      fs.readdirSync(testPath, options);
    }).toThrow(expectedError);
  });

  it("readlink throws on invalid encoding", () => {
    expect(() => {
      fs.readlink(testPath, options, () => {});
    }).toThrow(expectedError);
  });

  it("readlinkSync throws on invalid encoding", () => {
    expect(() => {
      fs.readlinkSync(testPath, options);
    }).toThrow(expectedError);
  });

  it("writeFile throws on invalid encoding", () => {
    expect(() => {
      fs.writeFile(testPath, "data", options, () => {});
    }).toThrow(expectedError);
  });

  it("writeFileSync throws on invalid encoding", () => {
    expect(() => {
      fs.writeFileSync(testPath, "data", options);
    }).toThrow(expectedError);
  });

  it("appendFile throws on invalid encoding", () => {
    expect(() => {
      fs.appendFile(testPath, "data", options, () => {});
    }).toThrow(expectedError);
  });

  it("appendFileSync throws on invalid encoding", () => {
    expect(() => {
      fs.appendFileSync(testPath, "data", options);
    }).toThrow(expectedError);
  });

  it("watch throws on invalid encoding", () => {
    expect(() => {
      fs.watch(testPath, options, () => {});
    }).toThrow(expectedError);
  });

  it("realpath throws on invalid encoding", () => {
    expect(() => {
      fs.realpath(testPath, options, () => {});
    }).toThrow(expectedError);
  });

  it("realpathSync throws on invalid encoding", () => {
    expect(() => {
      fs.realpathSync(testPath, options);
    }).toThrow(expectedError);
  });

  it("mkdtemp throws on invalid encoding", () => {
    expect(() => {
      fs.mkdtemp(testPath, options, () => {});
    }).toThrow(expectedError);
  });

  it("mkdtempSync throws on invalid encoding", () => {
    expect(() => {
      fs.mkdtempSync(testPath, options);
    }).toThrow(expectedError);
  });

  it("ReadStream throws on invalid encoding", () => {
    expect(() => {
      fs.ReadStream(testPath, options);
    }).toThrow(expectedError);
  });

  it("WriteStream throws on invalid encoding", () => {
    expect(() => {
      fs.WriteStream(testPath, options);
    }).toThrow(expectedError);
  });
});

it("fs.readv returns object", async done => {
  const fd = await promisify(fs.open)(import.meta.path, "r");
  const buffers = [Buffer.alloc(10), Buffer.alloc(10)];
  fs.readv(fd, buffers, 0, (err, bytesRead, output) => {
    promisify(fs.close)(fd);
    if (err) {
      done(err);
      return;
    }

    expect(bytesRead).toBe(20);
    expect(output).toEqual(buffers);
    done();
  });
});

it("fs.writev returns object", async done => {
  const outpath = tempDirWithFiles("fswritevtest", { "a.txt": "b" });
  const fd = await promisify(fs.open)(join(outpath, "b.txt"), "w");
  const buffers = [Buffer.alloc(10), Buffer.alloc(10)];
  fs.writev(fd, buffers, 0, (err, bytesWritten, output) => {
    promisify(fs.close)(fd);
    if (err) {
      done(err);
      return;
    }

    expect(bytesWritten).toBe(20);
    expect(output).toEqual(buffers);
    done();
  });
});

describe("FileHandle", () => {
  it("FileHandle#read returns object", async () => {
    await using fd = await fs.promises.open(__filename);
    const buf = Buffer.alloc(10);
    expect(await fd.read(buf, 0, 10, 0)).toEqual({ bytesRead: 10, buffer: buf });
  });

  it("FileHandle#readv returns object", async () => {
    await using fd = await fs.promises.open(__filename);
    const buffers = [Buffer.alloc(10), Buffer.alloc(10)];
    expect(await fd.readv(buffers, 0)).toEqual({ bytesRead: 20, buffers });
  });

  it("FileHandle#write throws EBADF when closed", async () => {
    let handle: FileHandle;
    let spy;
    {
      await using fd = await fs.promises.open(__filename);
      handle = fd;
      spy = spyOn(handle, "close");
      const buffers = [Buffer.alloc(10), Buffer.alloc(10)];
      expect(await fd.readv(buffers, 0)).toEqual({ bytesRead: 20, buffers });
    }
    expect(handle.close).toHaveBeenCalled();
    expect(async () => await handle.read(Buffer.alloc(10))).toThrow("Bad file descriptor");
  });

  it("FileHandle#write returns object", async () => {
    await using fd = await fs.promises.open(`${tmpdir()}/${Date.now()}.writeFile.txt`, "w");
    const buf = Buffer.from("test");
    expect(await fd.write(buf, 0, 4, 0)).toEqual({ bytesWritten: 4, buffer: buf });
  });

  it("FileHandle#writev returns object", async () => {
    await using fd = await fs.promises.open(`${tmpdir()}/${Date.now()}.writeFile.txt`, "w");
    const buffers = [Buffer.from("test"), Buffer.from("test")];
    expect(await fd.writev(buffers, 0)).toEqual({ bytesWritten: 8, buffers });
  });

  it("FileHandle#readFile returns buffer", async () => {
    await using fd = await fs.promises.open(__filename);
    const buf = await fd.readFile();
    expect(buf instanceof Buffer).toBe(true);
  });

  it("FileHandle#readableWebStream", async () => {
    await using fd = await fs.promises.open(__filename);
    const stream = fd.readableWebStream();
    const reader = stream.getReader();
    const chunk = await reader.read();
    expect(chunk.value instanceof Uint8Array).toBe(true);
    reader.releaseLock();
  });

  it("FileHandle#createReadStream", async () => {
    await using fd = await fs.promises.open(__filename);
    const readable = fd.createReadStream();
    const data = await new Promise(resolve => {
      let data = "";
      readable.on("data", chunk => {
        data += chunk;
      });
      readable.on("end", () => {
        resolve(data);
      });
    });

    expect(data).toBe(readFileSync(__filename, "utf8"));
  });

  it("FileHandle#writeFile", async () => {
    const path = `${tmpdir()}/${Date.now()}.writeFile.txt`;
    await using fd = await fs.promises.open(path, "w");
    await fd.writeFile("File written successfully");
    expect(readFileSync(path, "utf8")).toBe("File written successfully");
  });

  it("FileHandle#createWriteStream", async () => {
    const path = `${tmpdir()}/${Date.now()}.createWriteStream.txt`;
    {
      await using fd = await fs.promises.open(path, "w");
      const stream = fd.createWriteStream();

      await new Promise((resolve, reject) => {
        stream.on("error", e => {
          reject(e);
        });

        stream.on("finish", () => {
          resolve(true);
        });

        stream.write("Test file written successfully");
        stream.end();
      });
    }

    expect(readFileSync(path, "utf8")).toBe("Test file written successfully");
  });

  it("FileHandle#createWriteStream fixture 2", async () => {
    const path = `${tmpdir()}/${Date.now()}.createWriteStream.txt`;
    {
      await using fd = await fs.promises.open(path, "w");
      const stream = fd.createWriteStream();

      await new Promise((resolve, reject) => {
        stream.on("error", e => {
          reject(e);
        });

        stream.on("close", () => {
          resolve(true);
        });

        stream.write("Test file written successfully");
        stream.end();
      });
    }

    expect(readFileSync(path, "utf8")).toBe("Test file written successfully");
  });

  // Node.js closes a FileHandle's fd in its native finalizer and raises
  // ERR_INVALID_STATE (DEP0137 end-of-life) when the handle is collected
  // without close(). Bun must reclaim the fd and surface the same diagnostic.
  it.concurrent.skipIf(isWindows)(
    "FileHandle collected without close() closes the fd and raises ERR_INVALID_STATE",
    async () => {
      const fixture = /* js */ `
        const fsp = require("node:fs/promises");
        const fs = require("node:fs");
        const os = require("node:os");
        const path = require("node:path");
        const fdDir = process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd";
        const nfds = () => fs.readdirSync(fdDir).length;
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-gc-"));
        const N = 50;
        const diags = [];
        process.on("uncaughtException", e => diags.push({ code: e.code, message: e.message }));

        (async () => {
          const before = nfds();
          await (async () => {
            for (let i = 0; i < N; i++) await fsp.open(path.join(dir, "f" + i), "w");
          })();
          // force GC until every leaked fd is reclaimed and every diagnostic lands
          for (let i = 0; i < 40 && (nfds() - before > 0 || diags.length < N); i++) {
            Bun.gc(true);
            await new Promise(r => setTimeout(r, 25));
          }
          const afterGC = nfds();
          const sample = diags[0] ?? {};

          // properly closed handles must not trip the finalizer
          const marker = diags.length;
          await (async () => {
            for (let i = 0; i < N; i++) await (await fsp.open(path.join(dir, "g" + i), "w")).close();
          })();
          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
            await new Promise(r => setTimeout(r, 25));
          }

          console.log(JSON.stringify({
            leakedAfterGC: afterGC - before,
            diagCount: diags.length,
            sampleCode: sample.code,
            sampleHasFd: typeof sample.message === "string" && sample.message.includes("File descriptor: "),
            falsePositives: diags.length - marker,
          }));
          fs.rmSync(dir, { recursive: true, force: true });
        })();
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ result: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
        result: {
          leakedAfterGC: 0,
          diagCount: 50,
          sampleCode: "ERR_INVALID_STATE",
          sampleHasFd: true,
          falsePositives: 0,
        },
        stderr: expect.not.stringContaining("error"),
        exitCode: 0,
      });
    },
  );
});

it("fdatasyncSync", () => {
  const temp = tmpdir();
  const fd = openSync(join(temp, "test.blob"), "w", 0o664);
  fdatasyncSync(fd);
  closeSync(fd);
});

it("fdatasync", done => {
  const temp = tmpdir();
  const fd = openSync(join(temp, "test.blob"), "w", 0o664);
  fdatasync(fd, function () {
    done(...arguments);
    closeSync(fd);
  });
});

it("Dirent.name setter", () => {
  const dirent = Object.create(Dirent.prototype);
  expect(dirent.name).toBeUndefined();
  dirent.name = "hello";
  expect(dirent.name).toBe("hello");
});

it("writeFileSync should correctly resolve ../..", () => {
  const base = tmpdirSync();
  const path = join(base, "foo", "bar");
  mkdirSync(path, { recursive: true });
  const cwd = process.cwd();
  process.chdir(path);
  writeFileSync("../../test.txt", "hello");
  expect(readFileSync(join(base, "test.txt"), "utf8")).toBe("hello");
  process.chdir(cwd);
});

it("writeFileSync in append should not truncate the file", () => {
  const path = join(tmpdirSync(), "should-not-append.txt");
  var str = "";
  writeFileSync(path, "---BEGIN---");
  str += "---BEGIN---";
  for (let i = 0; i < 10; i++) {
    const line = "Line #" + i;
    str += line;
    writeFileSync(path, line, { flag: "a" });
  }
  expect(readFileSync(path, "utf8")).toBe(str);
});

it.concurrent("await readdir #3931", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "./repro-3931.js")],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

it("writeFileSync NOT in append SHOULD truncate the file", () => {
  const path = join(tmpdirSync(), "should-not-append.txt");

  for (let options of [{ flag: "w" }, { flag: undefined }, {}, undefined]) {
    writeFileSync(path, "---BEGIN---", options);
    var str = "---BEGIN---";
    expect(readFileSync(path, "utf8")).toBe(str);
    for (let i = 0; i < 10; i++) {
      const line = "Line #" + i;
      str = line;
      writeFileSync(path, line, options);
      expect(readFileSync(path, "utf8")).toBe(str);
    }
  }
});

// On Windows `fs.writeFileSync(path, ...)` opens via bun_sys::openat
// (NtCreateFile), so this exercises the O_CREAT/O_EXCL/O_TRUNC -> create
// disposition mapping in openat_windows_impl directly. On POSIX it is the
// plain openat(2) flag behavior. Every row matches Node.
describe("writeFileSync numeric open-flag matrix", () => {
  const { O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND } = constants;

  type Outcome = "ZZ23456789" | "ZZ" | "0123456789ZZ" | "ENOENT" | "EEXIST";
  const cases: [number, string, { exists: Outcome; missing: Outcome }][] = [
    // access | disposition flags ...           label                          over existing   over missing
    [O_WRONLY, "WRONLY", { exists: "ZZ23456789", missing: "ENOENT" }],
    [O_WRONLY | O_CREAT, "WRONLY|CREAT", { exists: "ZZ23456789", missing: "ZZ" }],
    [O_WRONLY | O_TRUNC, "WRONLY|TRUNC", { exists: "ZZ", missing: "ENOENT" }],
    [O_WRONLY | O_CREAT | O_TRUNC, "WRONLY|CREAT|TRUNC", { exists: "ZZ", missing: "ZZ" }],
    [O_WRONLY | O_CREAT | O_EXCL, "WRONLY|CREAT|EXCL", { exists: "EEXIST", missing: "ZZ" }],
    [O_WRONLY | O_CREAT | O_EXCL | O_TRUNC, "WRONLY|CREAT|EXCL|TRUNC", { exists: "EEXIST", missing: "ZZ" }],
    [O_RDWR, "RDWR", { exists: "ZZ23456789", missing: "ENOENT" }],
    [O_RDWR | O_CREAT, "RDWR|CREAT", { exists: "ZZ23456789", missing: "ZZ" }],
    [O_RDWR | O_TRUNC, "RDWR|TRUNC", { exists: "ZZ", missing: "ENOENT" }],
    [O_RDWR | O_CREAT | O_TRUNC, "RDWR|CREAT|TRUNC", { exists: "ZZ", missing: "ZZ" }],
    [O_RDWR | O_CREAT | O_EXCL, "RDWR|CREAT|EXCL", { exists: "EEXIST", missing: "ZZ" }],
    [O_RDWR | O_CREAT | O_EXCL | O_TRUNC, "RDWR|CREAT|EXCL|TRUNC", { exists: "EEXIST", missing: "ZZ" }],
    [O_WRONLY | O_APPEND, "WRONLY|APPEND", { exists: "0123456789ZZ", missing: "ENOENT" }],
    [O_WRONLY | O_CREAT | O_APPEND, "WRONLY|CREAT|APPEND", { exists: "0123456789ZZ", missing: "ZZ" }],
    [O_WRONLY | O_APPEND | O_TRUNC, "WRONLY|APPEND|TRUNC", { exists: "ZZ", missing: "ENOENT" }],
    [O_WRONLY | O_CREAT | O_APPEND | O_TRUNC, "WRONLY|CREAT|APPEND|TRUNC", { exists: "ZZ", missing: "ZZ" }],
  ];

  function probe(flag: number, seeded: boolean): string {
    using dir = tempDir("wf-flag-matrix", seeded ? { "f.txt": "0123456789" } : {});
    const p = join(String(dir), "f.txt");
    try {
      writeFileSync(p, "ZZ", { flag });
      return readFileSync(p, "utf8");
    } catch (e: any) {
      return e.code;
    }
  }

  for (const [flag, name, expected] of cases) {
    it(`${name} (O_${name.replace(/\|/g, " | O_")})`, () => {
      expect({ exists: probe(flag, true), missing: probe(flag, false) }).toEqual(expected);
    });
  }
});

describe("writeFile with a non-truncating flag", () => {
  const flags = ["r+", "rs+", constants.O_RDWR];

  it.each(flags)("writeFileSync with flag %p overwrites in place", flag => {
    const path = join(tmpdirSync(), "in-place.txt");
    writeFileSync(path, "0123456789");
    writeFileSync(path, "ZZ", { flag });
    expect(readFileSync(path, "utf8")).toBe("ZZ23456789");
  });

  it.each(flags)("promises.writeFile with flag %p overwrites in place", async flag => {
    const path = join(tmpdirSync(), "in-place.txt");
    writeFileSync(path, "0123456789");
    await promises.writeFile(path, "ZZ", { flag });
    expect(readFileSync(path, "utf8")).toBe("ZZ23456789");
  });

  it.each(flags)("fs.writeFile with flag %p overwrites in place", async flag => {
    const path = join(tmpdirSync(), "in-place.txt");
    writeFileSync(path, "0123456789");
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    fs.writeFile(path, "ZZ", { flag }, err => (err ? reject(err) : resolve()));
    await promise;
    expect(readFileSync(path, "utf8")).toBe("ZZ23456789");
  });

  // An iterable `data` takes a separate slow path in fs.promises, with its own
  // truncate.
  it.each(["r+", "rs+"])("promises.writeFile of an async iterable with flag %p overwrites in place", async flag => {
    const path = join(tmpdirSync(), "in-place-async-iter.txt");
    writeFileSync(path, "0123456789");
    await promises.writeFile(
      path,
      (async function* () {
        yield "ZZ";
      })(),
      { flag },
    );
    expect(readFileSync(path, "utf8")).toBe("ZZ23456789");
  });

  it.each(["r+", "rs+"])("promises.writeFile of a sync iterable with flag %p overwrites in place", async flag => {
    const path = join(tmpdirSync(), "in-place-sync-iter.txt");
    writeFileSync(path, "0123456789");
    await promises.writeFile(
      path,
      (function* () {
        yield "ZZ";
      })(),
      { flag },
    );
    expect(readFileSync(path, "utf8")).toBe("ZZ23456789");
  });

  it.each(["w", "w+"])("promises.writeFile of an async iterable with flag %p still truncates", async flag => {
    const path = join(tmpdirSync(), "truncating-async-iter.txt");
    writeFileSync(path, "0123456789");
    await promises.writeFile(
      path,
      (async function* () {
        yield "ZZ";
      })(),
      { flag },
    );
    expect(readFileSync(path, "utf8")).toBe("ZZ");
  });

  it("writeFileSync on a file descriptor does not truncate", () => {
    const path = join(tmpdirSync(), "in-place-fd.txt");
    writeFileSync(path, "0123456789");
    const fd = openSync(path, "r+");
    try {
      writeFileSync(fd, "ZZ");
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(path, "utf8")).toBe("ZZ23456789");
  });

  it.each(["w", "w+"])("writeFileSync with flag %p still truncates", flag => {
    const path = join(tmpdirSync(), "truncating.txt");
    writeFileSync(path, "0123456789");
    writeFileSync(path, "ZZ", { flag });
    expect(readFileSync(path, "utf8")).toBe("ZZ");
  });
});

// A write that dies partway through must not leave the old tail sitting behind
// the bytes that did land. `ulimit -f 1` gives the child a 512 byte RLIMIT_FSIZE,
// and Linux's generic_write_checks() then clamps the write to the limit and fails
// the next one with EFBIG. Linux-only: BSD kernels reject the whole write instead,
// so the byte split is not portable.
describe.skipIf(!isLinux)("writeFileSync when the write fails partway", () => {
  const fixture = join(import.meta.dir, "fs-writeFile-write-error-fixture.js");

  async function runUnderFileSizeLimit(path: string, flag: string) {
    writeFileSync(path, Buffer.alloc(2000, "B"));
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -f 1; exec "$0" "$1" "$2" "$3"`, bunExe(), fixture, path, flag],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderrHasError: stderr.includes("error:"), exitCode }).toEqual({ stderrHasError: false, exitCode: 0 });
    return JSON.parse(stdout);
  }

  it.each(["default", "w", "w+"])("with flag %p the file holds only what was written", async flag => {
    const path = join(tmpdirSync(), "write-error.bin");
    const { code, size, written, stale } = await runUnderFileSizeLimit(path, flag);
    expect({ code, stale, sizeIsOnlyWrittenBytes: size === written }).toEqual({
      code: "EFBIG",
      stale: 0,
      sizeIsOnlyWrittenBytes: true,
    });
  });

  // 512 new bytes over the head, the other 1488 untouched, and no resize.
  it("with flag 'r+' the rest of the file survives", async () => {
    const path = join(tmpdirSync(), "write-error-in-place.bin");
    const { code, size, written, stale } = await runUnderFileSizeLimit(path, "r+");
    expect({ code, size, written, stale }).toEqual({ code: "EFBIG", size: 2000, written: 512, stale: 1488 });
  });
});

// Writes at or above the preallocate threshold take the fallocate() path, which
// grows the file before the data lands. O_APPEND then writes past the grown end,
// leaving a hole of zeroes where the data belongs.
describe("writeFile with a preallocate-sized buffer", () => {
  const big = Buffer.alloc(3 * 1024 * 1024, "A");

  it("appends with flag 'a'", () => {
    const path = join(tmpdirSync(), "append-big.bin");
    writeFileSync(path, "HEADER");
    writeFileSync(path, big, { flag: "a" });
    const out = readFileSync(path);
    expect(out.subarray(0, 6).toString()).toBe("HEADER");
    expect(out.indexOf(0)).toBe(-1);
    expect(out.length).toBe(6 + big.length);
  });

  it("appends through a file descriptor opened with 'a'", () => {
    const path = join(tmpdirSync(), "append-big-fd.bin");
    writeFileSync(path, "HEADER");
    const fd = openSync(path, "a");
    try {
      writeFileSync(fd, big);
    } finally {
      closeSync(fd);
    }
    const out = readFileSync(path);
    expect(out.subarray(0, 6).toString()).toBe("HEADER");
    expect(out.indexOf(0)).toBe(-1);
    expect(out.length).toBe(6 + big.length);
  });

  it("keeps the tail of a larger file with flag 'r+'", () => {
    const path = join(tmpdirSync(), "in-place-big.bin");
    writeFileSync(path, Buffer.alloc(4 * 1024 * 1024, "B"));
    writeFileSync(path, big, { flag: "r+" });
    const out = readFileSync(path);
    expect(out.subarray(0, big.length).equals(big)).toBe(true);
    expect(out.indexOf("B")).toBe(big.length);
    expect(out.length).toBe(4 * 1024 * 1024);
  });

  it("truncates a larger file with the default flag", () => {
    const path = join(tmpdirSync(), "truncating-big.bin");
    writeFileSync(path, Buffer.alloc(4 * 1024 * 1024, "B"));
    writeFileSync(path, big);
    const out = readFileSync(path);
    expect(out.equals(big)).toBe(true);
  });
});

describe("copyFileSync", () => {
  it("should work for files < 128 KB", () => {
    const tempdir = tmpdirTestMkdir();

    // that don't exist
    copyFileSync(import.meta.path, tempdir + "/copyFileSync.js");
    expect(existsSync(tempdir + "/copyFileSync.js")).toBe(true);
    expect(readFileSync(tempdir + "/copyFileSync.js", "utf-8")).toBe(readFileSync(import.meta.path, "utf-8"));

    // that do exist
    copyFileSync(tempdir + "/copyFileSync.js", tempdir + "/copyFileSync.js1");
    writeFileSync(tempdir + "/copyFileSync.js1", "hello");
    copyFileSync(tempdir + "/copyFileSync.js1", tempdir + "/copyFileSync.js");

    expect(readFileSync(tempdir + "/copyFileSync.js", "utf-8")).toBe("hello");
  });

  it("should work for files > 128 KB ", () => {
    const tempdir = tmpdirTestMkdir();
    var buffer = new Int32Array(128 * 1024);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = i % 256;
    }

    const hash = Bun.hash(buffer.buffer);
    writeFileSync(tempdir + "/copyFileSync.src.blob", buffer.buffer);

    expect(existsSync(tempdir + "/copyFileSync.dest.blob")).toBe(false);
    expect(existsSync(tempdir + "/copyFileSync.src.blob")).toBe(true);
    copyFileSync(tempdir + "/copyFileSync.src.blob", tempdir + "/copyFileSync.dest.blob");

    expect(Bun.hash(readFileSync(tempdir + "/copyFileSync.dest.blob"))).toBe(hash);
    buffer[0] = 255;
    writeFileSync(tempdir + "/copyFileSync.src.blob", buffer.buffer);
    copyFileSync(tempdir + "/copyFileSync.src.blob", tempdir + "/copyFileSync.dest.blob");
    expect(Bun.hash(readFileSync(tempdir + "/copyFileSync.dest.blob"))).toBe(Bun.hash(buffer.buffer));
  });

  it("constants are right", () => {
    expect(fs.constants.COPYFILE_EXCL).toBe(1);
    expect(fs.constants.COPYFILE_FICLONE).toBe(2);
    expect(fs.constants.COPYFILE_FICLONE_FORCE).toBe(4);
  });

  it("FICLONE option does not error ever", () => {
    const tempdir = tmpdirTestMkdir();

    // that don't exist
    copyFileSync(import.meta.path, tempdir + "/copyFileSync.js", fs.constants.COPYFILE_FICLONE);
    copyFileSync(import.meta.path, tempdir + "/copyFileSync.js", fs.constants.COPYFILE_FICLONE);
    copyFileSync(import.meta.path, tempdir + "/copyFileSync.js", fs.constants.COPYFILE_FICLONE);
  });

  it("COPYFILE_EXCL works", () => {
    const tempdir = tmpdirTestMkdir();

    // that don't exist
    copyFileSync(import.meta.path, tempdir + "/copyFileSync.js", fs.constants.COPYFILE_EXCL);
    expect(() => {
      copyFileSync(import.meta.path, tempdir + "/copyFileSync.js", fs.constants.COPYFILE_EXCL);
    }).toThrow();
  });

  if (process.platform === "linux") {
    describe("should work when copyFileRange is not available", () => {
      it("on large files", () => {
        const tempdir = tmpdirTestMkdir();
        var buffer = new Int32Array(128 * 1024);
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = i % 256;
        }

        const hash = Bun.hash(buffer.buffer);
        const src = tempdir + "/copyFileSync.src.blob";
        const dest = tempdir + "/copyFileSync.dest.blob";

        writeFileSync(src, buffer.buffer);
        try {
          expect(existsSync(dest)).toBe(false);

          const { exitCode } = spawnSync({
            stdio: ["inherit", "inherit", "inherit"],
            cmd: [bunExe(), join(import.meta.dir, "./fs-fixture-copyFile-no-copy_file_range.js"), src, dest],
            env: {
              ...bunEnv,
              BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1",
            },
          });
          expect(exitCode).toBe(0);

          expect(Bun.hash(readFileSync(dest))).toBe(hash);
        } finally {
          rmSync(src, { force: true });
          rmSync(dest, { force: true });
        }
      });

      it("on small files", () => {
        const tempdir = tmpdirTestMkdir();
        var buffer = new Int32Array(1 * 1024);
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = i % 256;
        }

        const hash = Bun.hash(buffer.buffer);
        const src = tempdir + "/copyFileSync.src.blob";
        const dest = tempdir + "/copyFileSync.dest.blob";

        try {
          writeFileSync(src, buffer.buffer);

          expect(existsSync(dest)).toBe(false);

          const { exitCode } = spawnSync({
            stdio: ["inherit", "inherit", "inherit"],
            cmd: [bunExe(), join(import.meta.dir, "./fs-fixture-copyFile-no-copy_file_range.js"), src, dest],
            env: {
              ...bunEnv,
              BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1",
            },
          });
          expect(exitCode).toBe(0);

          expect(Bun.hash(readFileSync(dest))).toBe(hash);
        } finally {
          rmSync(src, { force: true });
          rmSync(dest, { force: true });
        }
      });
    });
  }
});

describe("mkdirSync", () => {
  it("should create a directory", () => {
    const now = Date.now().toString();
    const base = join(now, ".mkdirSync", "1234", "hi");
    const tempdir = `${tmpdir()}/${base}`;
    expect(existsSync(tempdir)).toBe(false);

    const res = mkdirSync(tempdir, { recursive: true });
    expect(res).toInclude(now);
    expect(res).not.toInclude(".mkdirSync");
    expect(existsSync(tempdir)).toBe(true);
  });

  it("should throw ENOENT for empty string", () => {
    expect(() => mkdirSync("", { recursive: true })).toThrow("no such file or directory");
    expect(() => mkdirSync("")).toThrow("no such file or directory");
  });

  it("throws for invalid options", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir2/foo/bar`;

    expect(() =>
      mkdirSync(
        path,
        // @ts-expect-error
        { recursive: "lalala" },
      ),
    ).toThrow('The "recursive" property must be of type boolean, got string');
  });
});

it("readdirSync on import.meta.dir", () => {
  const dirs = readdirSync(import.meta.dir);
  expect(dirs.length > 0).toBe(true);
  var match = false;
  gc(true);
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] === import.meta.file) {
      match = true;
    }
  }
  gc(true);
  expect(match).toBe(true);
});

it("Dirent has the expected fields", () => {
  const dir = tmpdirSync();
  writeFileSync(join(dir, "file.txt"), "");
  const dirs = readdirSync(dir, { withFileTypes: true });
  expect(dirs.length).toBe(1);
  expect(dirs[0].name).toBe("file.txt");
  expect(dirs[0].path).toBe(dir);
  expect(dirs[0].parentPath).toBe(dir);
});

it("promises.readdir on a large folder", async () => {
  const huge = tmpdirSync();
  for (let i = 0; i < 128; i++) {
    writeFileSync(join(huge, "file-" + i), "");
  }
  for (let j = 0; j < 4; j++) {
    const promises = await Promise.all([
      fs.promises.readdir(huge),
      fs.promises.readdir(huge),
      fs.promises.readdir(huge),
      fs.promises.readdir(huge),
    ]);

    for (let chunk of promises) {
      expect(chunk).toHaveLength(128);
      chunk.sort();

      let count = 0;
      for (let i = 0; i < 128; i++) {
        const current = chunk[i];
        if (!current.startsWith("file-")) {
          throw new Error("invalid file name");
        }

        const num = parseInt(current.slice(5));
        // @ts-expect-error
        count += !!(num >= 0 && num < 128);
      }

      expect(count).toBe(128);
    }
  }
  rmSync(huge, { force: true, recursive: true });
});

it("promises.readFile", async () => {
  expect(await fs.promises.readFile(import.meta.path, "utf-8")).toEqual(readFileSync(import.meta.path, "utf-8"));
  expect(await fs.promises.readFile(import.meta.path, { encoding: "latin1" })).toEqual(
    readFileSync(import.meta.path, { encoding: "latin1" }),
  );

  // We do this 20 times to check for any GC issues.
  for (let i = 0; i < 20; i++) {
    try {
      await fs.promises.readFile("/i-dont-exist", "utf-8");
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe("ENOENT: no such file or directory, open '/i-dont-exist'");
      expect(e.code).toBe("ENOENT");
      expect(e.errno).toBe(-2);
      expect(e.path).toBe("/i-dont-exist");
    }
  }
});

describe("promises.readFile", async () => {
  const nodeOutput = [
    {
      "encoding": "utf8",
      "text": "ascii",
      "correct": {
        "type": "Buffer",
        "data": [97, 115, 99, 105, 105],
      },
      "out": "ascii",
    },
    {
      "encoding": "utf8",
      "text": "utf16 🍇 🍈 🍉 🍊 🍋",
      "correct": {
        "type": "Buffer",
        "data": [
          117, 116, 102, 49, 54, 32, 240, 159, 141, 135, 32, 240, 159, 141, 136, 32, 240, 159, 141, 137, 32, 240, 159,
          141, 138, 32, 240, 159, 141, 139,
        ],
      },
      "out": "utf16 🍇 🍈 🍉 🍊 🍋",
    },
    {
      "encoding": "utf8",
      "text": "👍",
      "correct": {
        "type": "Buffer",
        "data": [240, 159, 145, 141],
      },
      "out": "👍",
    },
    {
      "encoding": "utf-8",
      "text": "ascii",
      "correct": {
        "type": "Buffer",
        "data": [97, 115, 99, 105, 105],
      },
      "out": "ascii",
    },
    {
      "encoding": "utf-8",
      "text": "utf16 🍇 🍈 🍉 🍊 🍋",
      "correct": {
        "type": "Buffer",
        "data": [
          117, 116, 102, 49, 54, 32, 240, 159, 141, 135, 32, 240, 159, 141, 136, 32, 240, 159, 141, 137, 32, 240, 159,
          141, 138, 32, 240, 159, 141, 139,
        ],
      },
      "out": "utf16 🍇 🍈 🍉 🍊 🍋",
    },
    {
      "encoding": "utf-8",
      "text": "👍",
      "correct": {
        "type": "Buffer",
        "data": [240, 159, 145, 141],
      },
      "out": "👍",
    },
    {
      "encoding": "utf16le",
      "text": "ascii",
      "correct": {
        "type": "Buffer",
        "data": [97, 0, 115, 0, 99, 0, 105, 0, 105, 0],
      },
      "out": "ascii",
    },
    {
      "encoding": "utf16le",
      "text": "utf16 🍇 🍈 🍉 🍊 🍋",
      "correct": {
        "type": "Buffer",
        "data": [
          117, 0, 116, 0, 102, 0, 49, 0, 54, 0, 32, 0, 60, 216, 71, 223, 32, 0, 60, 216, 72, 223, 32, 0, 60, 216, 73,
          223, 32, 0, 60, 216, 74, 223, 32, 0, 60, 216, 75, 223,
        ],
      },
      "out": "utf16 🍇 🍈 🍉 🍊 🍋",
    },
    {
      "encoding": "utf16le",
      "text": "👍",
      "correct": {
        "type": "Buffer",
        "data": [61, 216, 77, 220],
      },
      "out": "👍",
    },
    {
      "encoding": "latin1",
      "text": "ascii",
      "correct": {
        "type": "Buffer",
        "data": [97, 115, 99, 105, 105],
      },
      "out": "ascii",
    },
    {
      "encoding": "latin1",
      "text": "utf16 🍇 🍈 🍉 🍊 🍋",
      "correct": {
        "type": "Buffer",
        "data": [117, 116, 102, 49, 54, 32, 60, 71, 32, 60, 72, 32, 60, 73, 32, 60, 74, 32, 60, 75],
      },
      "out": "utf16 <G <H <I <J <K",
    },
    {
      "encoding": "latin1",
      "text": "👍",
      "correct": {
        "type": "Buffer",
        "data": [61, 77],
      },
      "out": "=M",
    },
    {
      "encoding": "binary",
      "text": "ascii",
      "correct": {
        "type": "Buffer",
        "data": [97, 115, 99, 105, 105],
      },
      "out": "ascii",
    },
    {
      "encoding": "binary",
      "text": "utf16 🍇 🍈 🍉 🍊 🍋",
      "correct": {
        "type": "Buffer",
        "data": [117, 116, 102, 49, 54, 32, 60, 71, 32, 60, 72, 32, 60, 73, 32, 60, 74, 32, 60, 75],
      },
      "out": "utf16 <G <H <I <J <K",
    },
    {
      "encoding": "binary",
      "text": "👍",
      "correct": {
        "type": "Buffer",
        "data": [61, 77],
      },
      "out": "=M",
    },
    {
      "encoding": "base64",
      "text": "ascii",
      "correct": {
        "type": "Buffer",
        "data": [106, 199, 34],
      },
      "out": "asci",
    },
    {
      "encoding": "hex",
      "text": "ascii",
      "correct": {
        "type": "Buffer",
        "data": [],
      },
      "out": "",
    },
    {
      "encoding": "hex",
      "text": "utf16 🍇 🍈 🍉 🍊 🍋",
      "correct": {
        "type": "Buffer",
        "data": [],
      },
      "out": "",
    },
    {
      "encoding": "hex",
      "text": "👍",
      "correct": {
        "type": "Buffer",
        "data": [],
      },
      "out": "",
    },
  ];

  it("& fs.promises.writefile encodes & decodes", async () => {
    const results = [];
    for (let encoding of [
      "utf8",
      "utf-8",
      "utf16le",
      "latin1",
      "binary",
      "base64",
      /* TODO: "base64url", */ "hex",
    ] as const) {
      for (let text of ["ascii", "utf16 🍇 🍈 🍉 🍊 🍋", "👍"]) {
        if (encoding === "base64" && !isAscii(Buffer.from(text)))
          // TODO: output does not match Node.js, and it's not a problem with readFile specifically.
          continue;
        const correct = Buffer.from(text, encoding);
        const outfile = join(
          tmpdir(),
          "promises.readFile-" + Date.now() + "-" + Math.random().toString(32) + "-" + encoding + ".txt",
        );
        writeFileSync(outfile, correct);
        const out = await fs.promises.readFile(outfile, encoding);
        {
          const { promise, resolve, reject } = Promise.withResolvers();

          fs.readFile(outfile, encoding, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });

          expect(await promise).toEqual(out);
        }

        expect(fs.readFileSync(outfile, encoding)).toEqual(out);
        await promises.rm(outfile, { force: true });

        expect(await promises.writeFile(outfile, text, encoding)).toBeUndefined();
        expect(await promises.readFile(outfile, encoding)).toEqual(out);
        promises.rm(outfile, { force: true });

        results.push({
          encoding,
          text,
          correct,
          out,
        });
      }
    }

    expect(JSON.parse(JSON.stringify(results, null, 2))).toEqual(nodeOutput);
  });
});

it("promises.readFile - UTF16 file path", async () => {
  const filename = `superduperduperdupduperdupersuperduperduperduperduperduperdupersuperduperduperduperduperduperdupersuperduperduperdupe-Bun-👍-${Date.now()}-${
    (Math.random() * 1024000) | 0
  }.txt`;
  const dest = join(tmpdir(), filename);
  await fs.promises.copyFile(import.meta.path, dest);
  const expected = readFileSync(import.meta.path, "utf-8");
  Bun.gc(true);
  for (let i = 0; i < 100; i++) {
    expect(await fs.promises.readFile(dest, "utf-8")).toEqual(expected);
  }
  Bun.gc(true);
});

it("promises.readFile - atomized file path", async () => {
  const filename = `superduperduperdupduperdupersuperduperduperduperduperduperdupersuperduperduperduperduperduperdupersuperduperduperdupe-Bun-👍-${Date.now()}-${
    (Math.random() * 1024000) | 0
  }.txt`;
  const destInput = join(tmpdir(), filename);
  // Force it to become an atomized string by making it a property access
  const dest: string = (
    {
      [destInput]: destInput,
      boop: 123,
    } as const
  )[destInput] as string;
  await fs.promises.copyFile(import.meta.path, dest);
  const expected = readFileSync(import.meta.path, "utf-8");
  Bun.gc(true);
  for (let i = 0; i < 100; i++) {
    expect(await fs.promises.readFile(dest, "utf-8")).toEqual(expected);
  }
  Bun.gc(true);
});

it("promises.readFile with buffer as file path", async () => {
  for (let i = 0; i < 10; i++)
    expect(await fs.promises.readFile(Buffer.from(import.meta.path), "utf-8")).toEqual(
      readFileSync(import.meta.path, "utf-8"),
    );
});

it("promises.readdir on a large folder withFileTypes", async () => {
  const huge = tmpdirSync();
  let withFileTypes = { withFileTypes: true } as const;
  for (let i = 0; i < 128; i++) {
    writeFileSync(join(huge, "file-" + i), "");
  }
  for (let j = 0; j < 4; j++) {
    const promises = await Promise.all([
      fs.promises.readdir(huge, withFileTypes),
      fs.promises.readdir(huge, withFileTypes),
      fs.promises.readdir(huge, withFileTypes),
      fs.promises.readdir(huge, withFileTypes),
    ]);

    for (let chunk of promises) {
      expect(chunk).toHaveLength(128);
      chunk.sort();

      let count = 0;
      for (let i = 0; i < 128; i++) {
        const current = chunk[i].name;
        if (!current.startsWith("file-")) {
          throw new Error("invalid file name");
        }

        const num = parseInt(current.slice(5));
        // @ts-expect-error
        count += !!(num >= 0 && num < 128);
      }

      expect(count).toBe(128);
    }
  }
  rmSync(huge, { force: true, recursive: true });
});

it("statSync throwIfNoEntry", () => {
  const path = join(tmpdirSync(), "does", "not", "exist");
  expect(statSync(path, { throwIfNoEntry: false })).toBeUndefined();
  expect(lstatSync(path, { throwIfNoEntry: false })).toBeUndefined();
});

it("statSync throwIfNoEntry: true", () => {
  const path = join(tmpdirSync(), "does", "not", "exist");
  expect(() => statSync(path, { throwIfNoEntry: true })).toThrow("no such file or directory");
  expect(() => statSync(path)).toThrow("no such file or directory");
  expect(() => lstatSync(path, { throwIfNoEntry: true })).toThrow("no such file or directory");
  expect(() => lstatSync(path)).toThrow("no such file or directory");
});

it("stat == statSync", async () => {
  const sync = statSync(import.meta.path);
  const async = await promises.stat(import.meta.path);
  expect(Object.entries(sync)).toEqual(Object.entries(async));
});

// https://github.com/oven-sh/bun/issues/1887
it("mkdtempSync, readdirSync, rmdirSync and unlinkSync with non-ascii", () => {
  const tempdir = mkdtempSync(`${tmpdir()}/emoji-fruit-🍇 🍈 🍉 🍊 🍋`);
  expect(existsSync(tempdir)).toBe(true);
  writeFileSync(tempdir + "/non-ascii-👍.txt", "hello");
  const dirs = readdirSync(tempdir);
  expect(dirs.length > 0).toBe(true);
  var match = false;
  gc(true);
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].endsWith("non-ascii-👍.txt")) {
      match = true;
      break;
    }
  }
  gc(true);
  expect(match).toBe(true);
  unlinkSync(tempdir + "/non-ascii-👍.txt");
  expect(existsSync(tempdir + "/non-ascii-👍.txt")).toBe(false);
  rmdirSync(tempdir);
  expect(existsSync(tempdir)).toBe(false);
});

it("mkdtempSync() empty name", () => {
  const tempdir = mkdtempSync(os.tmpdir());
  expect(existsSync(tempdir)).toBe(true);
  writeFileSync(tempdir + "/non-ascii-👍.txt", "hello");
  const dirs = readdirSync(tempdir);
  expect(dirs.length > 0).toBe(true);
  var match = false;
  gc(true);
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].endsWith("non-ascii-👍.txt")) {
      match = true;
      break;
    }
  }
  gc(true);
  expect(match).toBe(true);
  unlinkSync(tempdir + "/non-ascii-👍.txt");
  expect(existsSync(tempdir + "/non-ascii-👍.txt")).toBe(false);
  rmdirSync(tempdir);
  expect(existsSync(tempdir)).toBe(false);
});

it("mkdtempSync() non-exist dir #2568", () => {
  const path = join(tmpdirSync(), "does", "not", "exist");
  try {
    expect(mkdtempSync(path)).toBeFalsy();
  } catch (err: any) {
    expect(err?.errno).toBe(-2);
  }
});

it("mkdtemp() non-exist dir #2568", done => {
  const path = join(tmpdirSync(), "does", "not", "exist");
  mkdtemp(path, (err, folder) => {
    try {
      expect(err?.errno).toBe(-2);
      expect(folder).toBeUndefined();
      done();
    } catch (e) {
      done(e);
    }
  });
});

describe("mkdtemp encoding option", () => {
  const base = tmpdirSync();
  const prefix = join(base, "mkenc-dé-");
  const prefixBytes = Buffer.from(prefix, "utf8");

  it("sync: 'buffer' returns a Buffer of the path bytes", () => {
    const result = mkdtempSync(prefix, { encoding: "buffer" });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.subarray(0, prefixBytes.length).equals(prefixBytes)).toBe(true);
    expect(result.length).toBe(prefixBytes.length + 6);
    expect(existsSync(result)).toBe(true);
  });

  it("sync: string shorthand 'buffer'", () => {
    const result = mkdtempSync(prefix, "buffer");
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it.each(["hex", "base64", "base64url", "latin1"] as const)("sync: '%s' re-encodes the path", encoding => {
    const result = mkdtempSync(prefix, { encoding });
    expect(typeof result).toBe("string");
    const decoded = Buffer.from(result, encoding);
    expect(decoded.subarray(0, prefixBytes.length).equals(prefixBytes)).toBe(true);
    expect(decoded.length).toBe(prefixBytes.length + 6);
    expect(existsSync(decoded)).toBe(true);
  });

  it("sync: default utf8 still returns a string", () => {
    const result = mkdtempSync(prefix);
    expect(typeof result).toBe("string");
    expect(result.startsWith(prefix)).toBe(true);
    expect(existsSync(result)).toBe(true);
  });

  it("callback: 'buffer' returns a Buffer", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    mkdtemp(prefix, { encoding: "buffer" }, (err, folder) => (err ? reject(err) : resolve(folder)));
    const result = await promise;
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(existsSync(result)).toBe(true);
  });

  it("promises: 'hex' re-encodes the path", async () => {
    const result = await promises.mkdtemp(prefix, "hex");
    expect(typeof result).toBe("string");
    const decoded = Buffer.from(result, "hex");
    expect(decoded.subarray(0, prefixBytes.length).equals(prefixBytes)).toBe(true);
    expect(existsSync(decoded)).toBe(true);
  });

  it("promises: 'buffer' returns a Buffer", async () => {
    const result = await promises.mkdtemp(prefix, { encoding: "buffer" });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(existsSync(result)).toBe(true);
  });
});

it("readdirSync on import.meta.dir with trailing slash", () => {
  const dirs = readdirSync(import.meta.dir + "/");
  expect(dirs.length > 0).toBe(true);
  // this file should exist in it
  var match = false;
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] === import.meta.file) {
      match = true;
    }
  }
  expect(match).toBe(true);
});

it("readdirSync works on empty directories", () => {
  const path = tmpdirSync();
  expect(readdirSync(path).length).toBe(0);
});

it("readdirSync works on directories with under 32 files", () => {
  const path = tmpdirSync();
  writeFileSync(`${path}/a`, "a");
  const results = readdirSync(path);
  expect(results.length).toBe(1);
  expect(results[0]).toBe("a");
});

it("readdirSync throws when given a file path", () => {
  try {
    readdirSync(import.meta.path);
    throw new Error("should not get here");
  } catch (exception: any) {
    expect(exception.name).toBe("Error");
    expect(exception.code).toBe("ENOTDIR");
  }
});

it("readdirSync throws when given a path that doesn't exist", () => {
  try {
    readdirSync(import.meta.path + "/does-not-exist/really");
    throw new Error("should not get here");
  } catch (exception: any) {
    // the correct error to return in this case is actually ENOENT (which we do on windows),
    // but on posix we return ENOTDIR
    expect(exception.name).toBe("Error");
    expect(exception.code).toMatch(/ENOTDIR|ENOENT/);
  }
});

it("readdirSync throws when given a file path with trailing slash", () => {
  try {
    readdirSync(import.meta.path + "/");
    throw new Error("should not get here");
  } catch (exception: any) {
    expect(exception.name).toBe("Error");
    expect(exception.code).toBe("ENOTDIR");
  }
});

// Node returns Buffer[] for { encoding: "buffer" }, not Uint8Array[].
it("readdir with { encoding: 'buffer' } returns Buffer entries", async () => {
  using dir = tempDir("readdir-buffer-entries", { "a.txt": "", "b.txt": "" });
  const summarize = (entries: Buffer[]) =>
    entries.map(entry => [Buffer.isBuffer(entry), entry.toString("utf8")]).sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const expected = [
    [true, "a.txt"],
    [true, "b.txt"],
  ];
  expect(summarize(readdirSync(String(dir), { encoding: "buffer" }))).toEqual(expected);
  expect(summarize(readdirSync(String(dir), { encoding: "buffer", recursive: true }))).toEqual(expected);
  expect(summarize(await promises.readdir(String(dir), { encoding: "buffer" }))).toEqual(expected);
  expect(
    summarize((await promisify(fs.readdir)(String(dir), { encoding: "buffer" } as const)) as unknown as Buffer[]),
  ).toEqual(expected);
});

// The error cleanup path previously called MarkedArrayBuffer.destroy() on
// structs stored by-value inside the entries ArrayList, which passed interior
// ArrayList pointers to the allocator (freeing entries.items.ptr for index 0 and
// then freeing it again in entries.deinit()). A self-referential symlink makes
// the recursive walk fail with ELOOP after entries have been collected, exercising
// that cleanup path.
it.skipIf(isWindows)(
  "readdirSync({encoding: 'buffer', recursive: true}) frees entries safely when a subdir fails to open",
  async () => {
    using dir = tempDir("readdir-buffer-error", {
      "a.txt": "a",
      "b.txt": "b",
      "c.txt": "c",
    });
    fs.symlinkSync("loop", join(String(dir), "loop"));

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const fs = require("fs");
          let code;
          for (let i = 0; i < 2; i++) {
            try {
              fs.readdirSync(${JSON.stringify(String(dir))}, { encoding: "buffer", recursive: true });
              throw new Error("expected readdirSync to throw");
            } catch (e) {
              code = e.code;
            }
          }
          console.log(code);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ELOOP", exitCode: 0 });
  },
);

// The per-task pending_err mutex was acquired via `lock()` (returns `()`) instead of
// `lock_guard()`, so it was never released: the next failing subtask on the same worker
// panicked "Deadlock detected" (debug) or blocked forever and the promise never settled.
it.skipIf(isWindows)("promises.readdir({recursive: true}) settles when multiple subtasks fail", async () => {
  using dir = tempDir("readdir-recursive-multi-error", {
    "keep.txt": "x",
  });
  // Self-referencing symlinks: opening one with O_DIRECTORY fails with
  // ELOOP, which is not swallowed by the recursive walker, so every
  // enqueued subtask hits the pending_err path.
  for (let i = 0; i < 64; i++) {
    const link = join(String(dir), `loop${i}`);
    fs.symlinkSync(link, link);
  }

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
          const fs = require("fs");
          fs.promises.readdir(${JSON.stringify(String(dir))}, { recursive: true }).then(
            r => console.log("resolved", r.length),
            e => console.log("rejected", e.code),
          );
        `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    timeout: 10_000,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "rejected ELOOP",
    exitCode: 0,
    signalCode: null,
  });
});

describe("readSync", () => {
  it("rejects the read when the length argument detaches the destination buffer during coercion", () => {
    const fd = openSync(import.meta.dir + "/readFileSync.txt", "r");
    try {
      // A plain numeric length still works.
      const ok = new Uint8Array(4);
      expect(readSync(fd, ok, 0, 4, 0)).toBe(4);

      // Coercing a non-numeric length argument re-enters JavaScript. If that
      // re-entry detaches the destination buffer, the call must be rejected
      // instead of reading into the previously captured backing store.
      const ab = new ArrayBuffer(65536);
      const buf = new Uint8Array(ab);
      // Keep the transferred ArrayBuffer reachable so its memory stays alive
      // for the duration of the call.
      let moved: ArrayBuffer | undefined;
      expect(() =>
        readSync(
          fd,
          buf,
          0,
          {
            valueOf() {
              moved = ab.transfer();
              return 65536;
            },
          } as any,
          0,
        ),
      ).toThrow();
      // The coercion side effect really ran: the destination view is detached
      // and its bytes now live in the transferred ArrayBuffer.
      expect(buf.byteLength).toBe(0);
      expect(moved?.byteLength).toBe(65536);
    } finally {
      closeSync(fd);
    }
  });

  const firstFourBytes = new Uint32Array(new TextEncoder().encode("File").buffer)[0];

  it("works on large files", () => {
    const dest = join(tmpdir(), "readSync-large-file.txt");
    rmSync(dest, { force: true });

    const writefd = openSync(dest, "w");
    writeSync(writefd, Buffer.from([0x10]), 0, 1, 4_900_000_000);
    closeSync(writefd);

    const fd = openSync(dest, "r");
    const out = Buffer.alloc(1);
    const bytes = readSync(fd, out, 0, 1, 4_900_000_000);
    expect(bytes).toBe(1);
    expect(out[0]).toBe(0x10);
    closeSync(fd);
    rmSync(dest, { force: true });
  });

  it("works with bigint on read", () => {
    const dest = join(tmpdir(), "readSync-large-file-bigint.txt");
    rmSync(dest, { force: true });

    const writefd = openSync(dest, "w");
    writeSync(writefd, Buffer.from([0x10]), 0, 1, 400);
    closeSync(writefd);

    const fd = openSync(dest, "r");
    const out = Buffer.alloc(1);
    const bytes = readSync(fd, out, 0, 1, 400n as any);
    expect(bytes).toBe(1);
    expect(out[0]).toBe(0x10);
    closeSync(fd);
    rmSync(dest, { force: true });
  });

  it("works with a position set to 0", () => {
    const fd = openSync(import.meta.dir + "/readFileSync.txt", "r");
    const four = new Uint8Array(4);

    {
      const count = readSync(fd, four, 0, 4, 0);
      const u32 = new Uint32Array(four.buffer)[0];
      expect(u32).toBe(firstFourBytes);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });

  it("works with offset + length passed but not position", () => {
    const fd = openSync(import.meta.dir + "/readFileSync.txt", "r");
    const four = new Uint8Array(4);
    {
      const count = readSync(fd, four, 0, 4);
      const u32 = new Uint32Array(four.buffer)[0];
      expect(u32).toBe(firstFourBytes);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });

  it("works without position set", () => {
    const fd = openSync(import.meta.dir + "/readFileSync.txt", "r");
    const four = new Uint8Array(4);
    {
      const count = readSync(fd, four);
      const u32 = new Uint32Array(four.buffer)[0];
      expect(u32).toBe(firstFourBytes);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });

  it("works with invalid fd but zero length", () => {
    expect(readSync(2147483640, Buffer.alloc(0))).toBe(0);
    expect(readSync(2147483640, Buffer.alloc(10), 0, 0, 0)).toBe(0);
  });
});

it("writevSync", () => {
  var fd = openSync(`${tmpdir()}/writevSync.txt`, "w");
  fs.ftruncateSync(fd, 0);
  const buffers = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])];
  const result = writevSync(fd, buffers);
  expect(result).toBe(9);
  closeSync(fd);

  fd = openSync(`${tmpdir()}/writevSync.txt`, "r");
  const buf = new Uint8Array(9);
  readSync(fd, buf, 0, 9, 0);
  expect(buf).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
});

it("pwritevSync", () => {
  var fd = openSync(`${tmpdir()}/pwritevSync.txt`, "w");
  fs.ftruncateSync(fd, 0);
  writeSync(fd, "lalalala", 0);
  const buffers = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])];
  const result = writevSync(fd, buffers, "lalalala".length);
  expect(result).toBe(9);
  closeSync(fd);

  const out = readFileSync(`${tmpdir()}/pwritevSync.txt`);
  expect(out.slice(0, "lalalala".length).toString()).toBe("lalalala");
  expect(out.slice("lalalala".length)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
});

it("readvSync", () => {
  var fd = openSync(`${tmpdir()}/readv.txt`, "w");
  fs.ftruncateSync(fd, 0);

  const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  writeSync(fd, buf, 0, 9, 0);
  closeSync(fd);

  var fd = openSync(`${tmpdir()}/readv.txt`, "r");
  const buffers = [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)];
  const result = readvSync(fd, buffers);
  expect(result).toBe(9);
  expect(buffers[0]).toEqual(new Uint8Array([1, 2, 3]));
  expect(buffers[1]).toEqual(new Uint8Array([4, 5, 6]));
  expect(buffers[2]).toEqual(new Uint8Array([7, 8, 9]));
  closeSync(fd);
});

it("preadv", () => {
  var fd = openSync(join(tmpdir(), "preadv.txt"), "w");
  fs.ftruncateSync(fd, 0);

  const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  writeSync(fd, buf, 0, buf.byteLength, 0);
  closeSync(fd);

  var fd = openSync(`${tmpdir()}/preadv.txt`, "r");
  const buffers = [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)];
  const result = readvSync(fd, buffers, 3);
  expect(result).toBe(9);
  expect(buffers[0]).toEqual(new Uint8Array([4, 5, 6]));
  expect(buffers[1]).toEqual(new Uint8Array([7, 8, 9]));
  expect(buffers[2]).toEqual(new Uint8Array([10, 11, 12]));
});

describe.concurrent("writev/readv with more than IOV_MAX buffers", () => {
  // IOV_MAX is 1024 on Linux and macOS. Node's libuv loops writev in
  // IOV_MAX-sized batches and caps readv at IOV_MAX; Bun previously passed
  // the whole array to one syscall and got EINVAL for any count > 1024.
  const n = 2000;
  const makeWriteBufs = () => Array.from({ length: n }, (_, i) => Buffer.from([i & 0xff]));
  const expectedBytes = Buffer.from(Array.from({ length: n }, (_, i) => i & 0xff));
  // libuv caps readv at IOV_MAX on POSIX; Windows libuv reads every buffer.
  const readvCap = isWindows ? n : 1024;

  it("writevSync writes every buffer", () => {
    using dir = tempDir("writev-iovmax-sync", {});
    const file = join(String(dir), "out");
    const fd = openSync(file, "w");
    try {
      expect(writevSync(fd, makeWriteBufs())).toBe(n);
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(file).equals(expectedBytes)).toBe(true);
  });

  it("writevSync with position writes every buffer", () => {
    using dir = tempDir("pwritev-iovmax-sync", {});
    const file = join(String(dir), "out");
    const fd = openSync(file, "w");
    try {
      writeSync(fd, Buffer.from("head"), 0, 4, 0);
      expect(writevSync(fd, makeWriteBufs(), 4)).toBe(n);
    } finally {
      closeSync(fd);
    }
    const out = readFileSync(file);
    expect(out.subarray(0, 4).toString()).toBe("head");
    expect(out.subarray(4).equals(expectedBytes)).toBe(true);
  });

  it("fs.writev (callback) writes every buffer", async () => {
    using dir = tempDir("writev-iovmax-cb", {});
    const file = join(String(dir), "out");
    const fd = openSync(file, "w");
    try {
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      fs.writev(fd, makeWriteBufs(), (err, written) => (err ? reject(err) : resolve(written)));
      expect(await promise).toBe(n);
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(file).equals(expectedBytes)).toBe(true);
  });

  it("FileHandle.writev writes every buffer", async () => {
    using dir = tempDir("writev-iovmax-fh", {});
    const file = join(String(dir), "out");
    const fh = await _promises.open(file, "w");
    try {
      const { bytesWritten } = await fh.writev(makeWriteBufs());
      expect(bytesWritten).toBe(n);
    } finally {
      await fh.close();
    }
    expect(readFileSync(file).equals(expectedBytes)).toBe(true);
  });

  it("readvSync caps at IOV_MAX instead of failing", () => {
    using dir = tempDir("readv-iovmax-sync", {});
    const file = join(String(dir), "in");
    writeFileSync(file, Buffer.alloc(n, 7));
    const fd = openSync(file, "r");
    try {
      const buffers = Array.from({ length: n }, () => Buffer.alloc(1));
      expect(readvSync(fd, buffers)).toBe(readvCap);
      expect(buffers[0][0]).toBe(7);
      expect(buffers[readvCap - 1][0]).toBe(7);
    } finally {
      closeSync(fd);
    }
  });

  it("readvSync with position caps at IOV_MAX instead of failing", () => {
    using dir = tempDir("preadv-iovmax-sync", {});
    const file = join(String(dir), "in");
    writeFileSync(file, Buffer.concat([Buffer.from("xxx"), Buffer.alloc(n, 7)]));
    const fd = openSync(file, "r");
    try {
      const buffers = Array.from({ length: n }, () => Buffer.alloc(1));
      expect(readvSync(fd, buffers, 3)).toBe(readvCap);
      expect(buffers[0][0]).toBe(7);
      expect(buffers[readvCap - 1][0]).toBe(7);
    } finally {
      closeSync(fd);
    }
  });

  it("FileHandle.readv caps at IOV_MAX instead of failing", async () => {
    using dir = tempDir("readv-iovmax-fh", {});
    const file = join(String(dir), "in");
    writeFileSync(file, Buffer.alloc(n, 7));
    const fh = await _promises.open(file, "r");
    try {
      const buffers = Array.from({ length: n }, () => Buffer.alloc(1));
      const { bytesRead } = await fh.readv(buffers, 0);
      expect(bytesRead).toBe(readvCap);
      expect(buffers[0][0]).toBe(7);
      expect(buffers[readvCap - 1][0]).toBe(7);
    } finally {
      await fh.close();
    }
  });
});

describe("writeSync", () => {
  it("works with bigint", () => {
    const dest = join(tmpdir(), "writeSync-large-file-bigint.txt");
    rmSync(dest, { force: true });

    const writefd = openSync(dest, "w");
    writeSync(writefd, Buffer.from([0x10]), 0, 1, 400n as any);
    closeSync(writefd);

    const fd = openSync(dest, "r");
    const out = Buffer.alloc(1);
    const bytes = readSync(fd, out, 0, 1, 400 as any);
    expect(bytes).toBe(1);
    expect(out[0]).toBe(0x10);
    closeSync(fd);
    rmSync(dest, { force: true });
  });

  it("works with a position set to 0", () => {
    const fd = openSync(import.meta.dir + "/writeFileSync.txt", "w+");
    {
      const count = writeSync(fd, new TextEncoder().encode("File"), 0, 4, 0);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });
  it("works without position set", () => {
    const fd = openSync(import.meta.dir + "/writeFileSync.txt", "w+");
    {
      const count = writeSync(fd, new TextEncoder().encode("File"));
      expect(count).toBe(4);
    }
    closeSync(fd);
  });

  // writeSync(fd, string[, position[, encoding]]): the encoding used to be
  // parsed but never applied, so utf16le/hex/base64/latin1 all wrote raw UTF-8.
  it("honors the encoding argument for strings", () => {
    const dest = join(tmpdirSync(), "writeSync-string-encoding.bin");
    const cases: [args: unknown[], expected: Buffer][] = [
      [["abc", 0, "utf16le"], Buffer.from("abc", "utf16le")],
      // Node consumes the position slot whatever its type; the encoding is
      // always the following argument.
      [["abc", null, "ucs2"], Buffer.from("abc", "utf16le")],
      [["abc", undefined, "utf16le"], Buffer.from("abc", "utf16le")],
      [["61626364", 0, "hex"], Buffer.from("abcd")],
      [["aGk=", null, "base64"], Buffer.from("hi")],
      [["\u00ff", 0, "latin1"], Buffer.from([0xff])],
      // Node writes UTF-8 for the "buffer" encoding name; it must not fall
      // into the latin1-narrowing path.
      [["\u00e9", 0, "buffer"], Buffer.from([0xc3, 0xa9])],
      // Same for a 16-bit string, which would otherwise hit a separate
      // low-byte-narrowing encoder (U+4E2D -> 0x2d).
      [["a\u00e9\u4e2d", 0, "buffer"], Buffer.from([0x61, 0xc3, 0xa9, 0xe4, 0xb8, 0xad])],
      // A lone string in the position slot is not an encoding.
      [["ab", "utf16le"], Buffer.from("ab")],
      [["abc", 0], Buffer.from("abc")],
      [["abc"], Buffer.from("abc")],
    ];
    for (const [args, expected] of cases) {
      const fd = openSync(dest, "w");
      let written: number;
      try {
        written = (writeSync as Function)(fd, ...args);
      } finally {
        closeSync(fd);
      }
      expect({ args, written, bytes: [...readFileSync(dest)] }).toEqual({
        args,
        written: expected.length,
        bytes: [...expected],
      });
    }
  });
});

describe("readFileSync", () => {
  it("works", () => {
    gc();
    const text = readFileSync(import.meta.dir + "/readFileSync.txt", "utf8");
    gc();
    expect(text).toBe("File read successfully");
    gc();
  });

  it("works with a file url", () => {
    gc();
    const text = readFileSync(new URL("./readFileSync.txt", import.meta.url), "utf8");
    gc();
    expect(text).toBe("File read successfully");
  });

  it("works with a file path which contains spaces", async () => {
    gc();
    const outpath = join(tmpdir(), "read file sync with space characters " + Math.random().toString(32) + " .txt");
    await Bun.write(outpath, Bun.file(Bun.fileURLToPath(new URL("./readFileSync.txt", import.meta.url))));
    const text = readFileSync(outpath, "utf8");
    gc();
    expect(text).toBe("File read successfully");
  });

  it("works with a file URL which contains spaces", async () => {
    gc();
    const outpath = join(tmpdir(), "read file sync with space characters " + Math.random().toString(32) + " .txt");
    await Bun.write(outpath, Bun.file(Bun.fileURLToPath(new URL("./readFileSync.txt", import.meta.url))));
    // on windows constructing a file url from an absolute path containing a drive letter will not add the "file:///" prefix
    // node.js has the same behavior, not sure what makes the most sense here
    const url = isWindows ? new URL("file:///" + outpath) : new URL(outpath, import.meta.url);
    const text = readFileSync(url, "utf8");
    gc();
    expect(text).toBe("File read successfully");
  });

  it.skipIf(isWindows)("works with special posix files in the filesystem", () => {
    const text = readFileSync("/dev/null", "utf8");
    gc();
    expect(text).toBe("");

    if (process.platform === "linux") {
      const text = readFileSync("/proc/filesystems");
      gc();
      expect(text.length > 0).toBe(true);
    }
  });

  it("returning Buffer works", () => {
    const text = readFileSync(import.meta.dir + "/readFileSync.txt");
    const encoded = [
      70, 105, 108, 101, 32, 114, 101, 97, 100, 32, 115, 117, 99, 99, 101, 115, 115, 102, 117, 108, 108, 121,
    ];
    for (let i = 0; i < encoded.length; i++) {
      expect(text[i]).toBe(encoded[i]);
    }
  });
});

describe("readFile", () => {
  it("works", async () => {
    gc();
    await new Promise((resolve, reject) => {
      readFile(import.meta.dir + "/readFileSync.txt", "utf8", (err, text) => {
        gc();
        expect(text).toBe("File read successfully");
        resolve(true);
      });
    });
  });

  it("returning Buffer works", async () => {
    gc();
    await new Promise((resolve, reject) => {
      gc();
      readFile(import.meta.dir + "/readFileSync.txt", (err, text) => {
        const encoded = [
          70, 105, 108, 101, 32, 114, 101, 97, 100, 32, 115, 117, 99, 99, 101, 115, 115, 102, 117, 108, 108, 121,
        ];
        gc();
        for (let i = 0; i < encoded.length; i++) {
          expect(text[i]).toBe(encoded[i]);
        }
        resolve(true);
      });
    });
  });

  it("works with flags", async () => {
    const mydir = tempDirWithFiles("fs-read", {});
    console.log(mydir);

    for (const [flag, code] of [
      ["a", "EBADF"],
      ["ax", "EBADF"],
      ["a+", undefined],
      ["as", "EBADF"],
      ["as+", undefined],
      ["r", "ENOENT"],
      ["rs", "ENOENT"],
      ["r+", "ENOENT"],
      ["rs+", "ENOENT"],
      ["w", "EBADF"],
      ["wx", "EBADF"],
      ["w+", undefined],
      ["wx+", undefined],
    ]) {
      const name = flag!.replace("+", "_plus") + ".txt";
      if (code == null) {
        expect(readFileSync(mydir + "/" + name, { encoding: "utf8", flag })).toBe("");
        expect(readFileSync(mydir + "/" + name, { encoding: "utf8" })).toBe("");
      } else {
        expect.toThrowWithCode(() => readFileSync(mydir + "/" + name, { encoding: "utf8", flag }), code);
        expect.toThrowWithCode(() => readFileSync(mydir + "/" + name, { encoding: "utf8" }), "ENOENT");
      }
    }
  });
});

describe("open with a numeric flag boxed as a double", () => {
  // https://github.com/oven-sh/bun/issues/32505
  // Go's `syscall/js` (GOOS=js GOARCH=wasm) reads every argument out of wasm
  // linear memory with DataView.getFloat64, so a valid integer flag such as
  // 578 (O_RDWR|O_CREAT|O_TRUNC) reaches fs.open boxed as a double instead of
  // an int32. Node accepts any integer-valued number; Bun must too.
  const asDouble = (n: number) => new Float64Array([n])[0];

  it("openSync accepts a double-boxed flag and honors it", () => {
    using dir = tempDir("fs-flags-double", {});
    const file = join(String(dir), "sync.txt");
    const flags = asDouble(constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC);
    expect(Number.isInteger(flags)).toBe(true);

    const fd = openSync(file, flags, 0o666);
    try {
      writeSync(fd, "hello\n");
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(file, "utf8")).toBe("hello\n");
  });

  it("async open accepts a double-boxed flag and honors it", async () => {
    using dir = tempDir("fs-flags-double-async", {});
    const file = join(String(dir), "async.txt");
    const flags = asDouble(constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC);

    const { promise, resolve, reject } = Promise.withResolvers<number>();
    fs.open(file, flags, 0o666, (err, fd) => (err ? reject(err) : resolve(fd)));
    const fd = await promise;
    try {
      writeSync(fd, "world\n");
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(file, "utf8")).toBe("world\n");
  });

  it("promises.open accepts a double-boxed flag and honors it", async () => {
    using dir = tempDir("fs-flags-double-promise", {});
    const file = join(String(dir), "promise.txt");
    const flags = asDouble(constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC);

    const handle = await promises.open(file, flags, 0o666);
    try {
      await handle.write("promise\n");
    } finally {
      await handle.close();
    }
    expect(readFileSync(file, "utf8")).toBe("promise\n");
  });

  it("still rejects a non-integer numeric flag", () => {
    using dir = tempDir("fs-flags-double-reject", {});
    const file = join(String(dir), "bad.txt");
    expect(() => openSync(file, asDouble(578.5), 0o666)).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
  });
});

describe("open flag string validation matches node", () => {
  // Node's stringToFlags is a case-sensitive exhaustive switch; anything not
  // in the table (including uppercase spellings like "W" or numeric strings
  // like "577") throws ERR_INVALID_ARG_VALUE.
  const validFlags = [
    "r",
    "rs",
    "sr",
    "r+",
    "rs+",
    "sr+",
    "w",
    "wx",
    "xw",
    "w+",
    "wx+",
    "xw+",
    "a",
    "ax",
    "xa",
    "as",
    "sa",
    "a+",
    "ax+",
    "xa+",
    "as+",
    "sa+",
  ];
  const invalidFlags = [
    "W",
    "R",
    "A",
    "A+",
    "R+",
    "W+",
    "RS",
    "Rs",
    "AS+",
    "0",
    "1",
    "577",
    "0o644",
    // Previously the Rust port parsed any leading-digit flag string into an
    // integer, so values at and past these width boundaries reached open(2).
    "65535",
    "65536",
    "2147483647",
    "2147483648",
    "4294967295",
    "4294967296",
    "xyz",
    "",
    true,
  ];

  it.each(invalidFlags)("openSync rejects flag %p with ERR_INVALID_ARG_VALUE", flag => {
    using dir = tempDir("fs-flags-invalid", {});
    const file = join(String(dir), "f.txt");
    let err: any;
    try {
      // @ts-expect-error intentionally passing bad flag types
      const fd = openSync(file, flag);
      closeSync(fd);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    // Node renders the received value with util.inspect.
    expect(err.message).toBe(`The argument 'flags' is invalid. Received ${inspect(flag)}`);
    expect(existsSync(file)).toBe(false);
  });

  it.each(validFlags)("openSync accepts flag %p", flag => {
    // O_EXCL ('x' in the flag string) fails on an existing file, while the
    // read-only flags need an existing file. Pick the target accordingly.
    using dir = tempDir("fs-flags-valid", { "existing.txt": "x" });
    const file = join(String(dir), flag.includes("x") ? "new.txt" : "existing.txt");
    const fd = openSync(file, flag);
    closeSync(fd);
  });

  it("callback open and promises.open reject uppercase flags", async () => {
    using dir = tempDir("fs-flags-invalid-async", {});
    const file = join(String(dir), "f.txt");
    // fs.open validates flags synchronously, matching Node.
    expect(() => fs.open(file, "W", () => {})).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
    await expect(promises.open(file, "W")).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
    });
    expect(existsSync(file)).toBe(false);
  });

  it("readFileSync and writeFileSync reject uppercase flag option", () => {
    using dir = tempDir("fs-flags-invalid-rw", { "f.txt": "x" });
    const file = join(String(dir), "f.txt");
    expect(() => readFileSync(file, { flag: "R" })).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
    expect(() => writeFileSync(file, "y", { flag: "W" })).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
  });

  it("rejects a String wrapper object even when it boxes a valid flag", () => {
    // Node's stringToFlags is a strict-equality switch, so only a primitive
    // string can match; `new String("w")` is an object and must throw.
    using dir = tempDir("fs-flags-string-object", {});
    const file = join(String(dir), "f.txt");
    expect(() => readFileSync(file, { flag: new String("w") as any })).toThrowWithCode(
      TypeError,
      "ERR_INVALID_ARG_VALUE",
    );
    expect(() => writeFileSync(file, "y", { flag: new String("w") as any })).toThrowWithCode(
      TypeError,
      "ERR_INVALID_ARG_VALUE",
    );
    expect(existsSync(file)).toBe(false);
  });
});

describe("open/mkdir mode string validation matches node", () => {
  // The last two hold a non-Latin-1 code unit, so JSC stores them 16-bit; a
  // raw 8-bit read of the UTF-16 buffer sees only "\u3737"'s low byte 0x37
  // ("7") and would wrongly accept it as mode 7.
  const invalidModes = ["0o755", "+755", "7_5_5", "888", "7a5", "", "7\u20225", "\u3737"];

  it.each(invalidModes)("openSync rejects mode string %p with ERR_INVALID_ARG_VALUE", mode => {
    using dir = tempDir("fs-mode-invalid", {});
    const file = join(String(dir), "f.txt");
    expect(() => openSync(file, "w", mode)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
    expect(existsSync(file)).toBe(false);
  });

  // "37777777777" is exactly u32::MAX: Node crashes on an internal IsInt32()
  // assertion there, which Bun deliberately does not replicate.
  it.each(["755", "0755", "0644", "0", "37777777776", "37777777777"])("openSync accepts octal mode string %p", mode => {
    using dir = tempDir("fs-mode-valid", {});
    const file = join(String(dir), "f.txt");
    const fd = openSync(file, "w", mode);
    closeSync(fd);
    expect(existsSync(file)).toBe(true);
  });

  it("accepts a valid octal mode string regardless of JSC's internal string storage", () => {
    // JSC does not narrow: a UTF-16 decode yields a 16-bit string even when
    // its content ("755") is pure ASCII. Storage bitness must be invisible,
    // so it must parse identically to the 8-bit "755" literal.
    const sixteenBit = new TextDecoder("utf-16le").decode(new Uint8Array([0x37, 0, 0x35, 0, 0x35, 0]));
    expect(sixteenBit).toBe("755");
    using dir = tempDir("fs-mode-16bit", {});
    const eightBitPath = join(String(dir), "a.txt");
    const sixteenBitPath = join(String(dir), "b.txt");
    closeSync(openSync(eightBitPath, "w", "755"));
    closeSync(openSync(sixteenBitPath, "w", sixteenBit));
    expect(statSync(sixteenBitPath).mode).toBe(statSync(eightBitPath).mode);
  });

  // Node range-checks the parsed octal string with validateUint32, so a value
  // past u32::MAX is ERR_OUT_OF_RANGE, not ERR_INVALID_ARG_VALUE.
  it.each(["40000000000", "777777777777"])("openSync rejects octal mode string %p as out of range", mode => {
    using dir = tempDir("fs-mode-oor", {});
    const file = join(String(dir), "f.txt");
    expect(() => openSync(file, "w", mode)).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
    expect(existsSync(file)).toBe(false);
  });

  it.each(invalidModes)("mkdirSync rejects mode string %p with ERR_INVALID_ARG_VALUE", mode => {
    using dir = tempDir("fs-mode-invalid-mkdir", {});
    expect(() => mkdirSync(join(String(dir), "sub"), { mode })).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
  });

  it("rejects a String wrapper object as a mode", () => {
    // Node's parseFileMode only octal-parses `typeof value === 'string'`, so a
    // boxed String falls through to the number validator (ERR_INVALID_ARG_TYPE).
    using dir = tempDir("fs-mode-string-object", {});
    expect(() => openSync(join(String(dir), "f.txt"), "w", new String("755") as any)).toThrowWithCode(
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
    // chmodSync has no options-bag form, so the wrapper reaches parseFileMode
    // directly and must be rejected the same way.
    const d = join(String(dir), "c");
    mkdirSync(d);
    expect(() => fs.chmodSync(d, new String("755") as any)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
  });

  it("mkdirSync treats a String wrapper as an options bag, like node", () => {
    // `typeof new String` is "object", so Node treats the wrapper as an options
    // bag and applies the default mode rather than parsing it as "700". Compare
    // against an options-less mkdirSync in the same process so umask cancels out.
    using dir = tempDir("fs-mode-mkdir-string-object", {});
    const wrapped = join(String(dir), "wrapped");
    const plain = join(String(dir), "plain");
    mkdirSync(wrapped, new String("700") as any);
    mkdirSync(plain);
    expect(statSync(wrapped).mode).toBe(statSync(plain).mode);
  });
});

describe("writeFileSync", () => {
  it("works", () => {
    const path = `${tmpdirSync()}/writeFileSync.txt`;
    writeFileSync(path, "File written successfully", "utf8");

    expect(readFileSync(path, "utf8")).toBe("File written successfully");
  });
  it("write file with mode, issue #3740", () => {
    const path = `${tmpdirSync()}/writeFileSyncWithMode.txt`;
    writeFileSync(path, "bun", { mode: 33188 });
    const stat = fs.statSync(path);
    expect(stat.mode).toBe(isWindows ? 33206 : 33188);
  });
  it("returning Buffer works", () => {
    const buffer = new Buffer([
      70, 105, 108, 101, 32, 119, 114, 105, 116, 116, 101, 110, 32, 115, 117, 99, 99, 101, 115, 115, 102, 117, 108, 108,
      121,
    ]);
    const path = `${tmpdirSync()}/blob.writeFileSync.txt`;
    writeFileSync(path, buffer);
    const out = readFileSync(path);

    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(out[i]);
    }
  });
  it("returning ArrayBuffer works", () => {
    const buffer = new Buffer([
      70, 105, 108, 101, 32, 119, 114, 105, 116, 116, 101, 110, 32, 115, 117, 99, 99, 101, 115, 115, 102, 117, 108, 108,
      121,
    ]);
    const path = `${tmpdirSync()}/blob2.writeFileSync.txt`;
    writeFileSync(path, buffer);
    const out = readFileSync(path);

    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(out[i]);
    }
  });
});

function triggerDOMJIT(target: fs.Stats, fn: (..._: any[]) => any, result: any) {
  for (let i = 0; i < 9999; i++) {
    if (fn.apply(target) !== result) {
      throw new Error("DOMJIT failed");
    }
  }
}

describe("lstat", () => {
  it("file metadata is correct", () => {
    const fileStats = lstatSync(join(import.meta.dir, "fs-stream.js"));
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(true);
    expect(fileStats.isDirectory()).toBe(false);

    triggerDOMJIT(fileStats, fileStats.isFile, true);
    triggerDOMJIT(fileStats, fileStats.isDirectory, false);
    triggerDOMJIT(fileStats, fileStats.isSymbolicLink, false);
  });

  it("folder metadata is correct", () => {
    const path = join(import.meta.dir, "../../../../test");
    const fileStats = lstatSync(path);
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(false);
    expect(fileStats.isDirectory()).toBe(true);

    triggerDOMJIT(fileStats, fileStats.isFile, false);
    triggerDOMJIT(fileStats, fileStats.isDirectory, true);
    triggerDOMJIT(fileStats, fileStats.isSymbolicLink, false);
  });

  it("symlink metadata is correct", () => {
    const link = join(tmpdirSync(), `fs-stream.link.js`);
    symlinkSync(join(import.meta.dir, "fs-stream.js"), link);
    const linkStats = lstatSync(link);
    expect(linkStats.isSymbolicLink()).toBe(true);
    expect(linkStats.isFile()).toBe(false);
    expect(linkStats.isDirectory()).toBe(false);

    triggerDOMJIT(linkStats, linkStats.isFile, false);
    triggerDOMJIT(linkStats, linkStats.isDirectory, false);
    triggerDOMJIT(linkStats, linkStats.isSymbolicLink, true);
  });
});

it("symlink", () => {
  const actual = join(tmpdirSync(), "fs-symlink.txt");
  try {
    unlinkSync(actual);
  } catch (e) {}

  symlinkSync(import.meta.path, actual);

  expect(realpathSync(actual)).toBe(realpathSync(import.meta.path));
});

it.if(isPosix)("realpathSync doesn't block on FIFO", () => {
  const path = join(tmpdirSync(), "test-fs-fifo-block.fifo");
  mkfifo(path, 0o666);
  realpathSync(path);
  unlinkSync(path);
});

// Regression guard for realpathSync on POSIX hosts. On Linux, getFdPath has
// a /dev/fd fallback for environments where /proc is broken (FreeBSD
// Linuxulator) or absent (minimal containers).
it.if(isPosix)("realpathSync resolves root, regular files, and symlinks", () => {
  expect(realpathSync("/")).toBe("/");

  const self = realpathSync(import.meta.path);
  expect(self).toStartWith("/");
  expect(existsSync(self)).toBe(true);

  using dir = tempDir("fs-realpath-getfdpath", {});
  const linkPath = join(String(dir), "link");
  symlinkSync(import.meta.path, linkPath);
  expect(realpathSync(linkPath)).toBe(self);
});

// src/sys/sys.zig getFdPath has an exhaustive per-OS switch: .windows
// (GetFinalPathNameByHandle), .mac (F_GETPATH), .linux (/proc/self/fd, also
// covers Android), .freebsd (fcntl F_KINFO + struct_kinfo_file). On every
// non-Windows target Bun ships, fd→path resolution is implemented — there is
// no platform that falls through to ENOSYS. realpathSync on POSIX is
// open() → getFdPath(fd), so an ENOSYS here means the per-OS arm is missing.
it.skipIf(isWindows)("realpathSync (getFdPath) is implemented on every POSIX target — never ENOSYS", () => {
  using dir = tempDir("fs-getfdpath-platform-arm", { "probe.txt": "x" });
  const probe = join(String(dir), "probe.txt");

  let resolved: string;
  try {
    resolved = realpathSync(probe);
  } catch (e: any) {
    // The Zig spec never returns ENOSYS from getFdPath: every Environment.os
    // value has a real implementation. If this fires, a target (FreeBSD's
    // F_KINFO arm, or Android via the .linux /proc/self/fd arm) was dropped.
    expect(e?.code).not.toBe("ENOSYS");
    expect(e?.errno).not.toBe(-os.constants.errno.ENOSYS);
    throw e;
  }

  expect(resolved).toStartWith("/");
  expect(readFileSync(resolved, "utf8")).toBe("x");
  // Idempotent: resolving the canonical path returns itself.
  expect(realpathSync(resolved)).toBe(resolved);
});

it("readlink", () => {
  const actual = join(tmpdirSync(), "fs-readlink.txt");
  try {
    unlinkSync(actual);
  } catch (e) {}

  symlinkSync(import.meta.path, actual);

  expect(readlinkSync(actual)).toBe(realpathSync(import.meta.path));
});

describe("readlink encoding option", () => {
  const base = tmpdirSync();
  const link = join(base, "lnk");
  let targetBytes: Buffer;
  beforeAll(() => {
    symlinkSync(join(base, "tgt-dé"), link);
    targetBytes = readlinkSync(link, { encoding: "buffer" }) as Buffer;
  });

  it("'buffer' returns a Buffer", () => {
    expect(Buffer.isBuffer(targetBytes)).toBe(true);
    expect(targetBytes.includes(Buffer.from("tgt-dé", "utf8"))).toBe(true);
  });

  it.each(["hex", "base64", "base64url", "latin1"] as const)("'%s' re-encodes the target", encoding => {
    const result = readlinkSync(link, { encoding });
    expect(typeof result).toBe("string");
    expect(result).toBe(targetBytes.toString(encoding));
  });

  it("default utf8 still returns a string", () => {
    const result = readlinkSync(link);
    expect(typeof result).toBe("string");
    expect(result).toBe(targetBytes.toString("utf8"));
  });
});

// On FUSE / some network filesystems a symlink target can exceed PATH_MAX,
// and POSIX readlink() may return exactly buf.len (truncated). Bun used to
// write the NUL terminator at buf[rc] which would be one past the end of the
// stack PathBuffer in that case. We can't create a >= PATH_MAX target on a
// normal filesystem, but we can exercise the longest-possible target to make
// sure the bounds check in sys.readlink doesn't fire early.
it.skipIf(isWindows)("readlink with PATH_MAX-1 target", () => {
  const dir = tmpdirSync();
  // Find the longest target the local filesystem will accept for symlink(2).
  // On Linux this is 4095, on macOS 1023. Bun's own path validation silently
  // replaces the target with "" when it is exactly MAX_PATH_BYTES long (and
  // Darwin accepts symlink("", link)), so start just below that boundary on
  // each platform rather than probing through it.
  let len = process.platform === "darwin" ? 1023 : 4095;
  let link: string;
  let target: string;
  while (true) {
    link = join(dir, "l" + len);
    target = Buffer.alloc(len, "x").toString();
    try {
      symlinkSync(target, link);
      break;
    } catch {
      if (len <= 1) throw new Error("could not create any symlink");
      len--;
    }
  }
  // readlinkSync must return the exact target, not error and not truncate.
  expect(readlinkSync(link).length).toBe(len);
  expect(readlinkSync(link)).toBe(target);
});

it.if(isWindows)("symlink on windows with forward slashes", async () => {
  const r = tmpdirSync();
  await fs.promises.rm(join(r, "files/2024"), { recursive: true, force: true });
  await fs.promises.mkdir(join(r, "files/2024"), { recursive: true });
  await fs.promises.writeFile(join(r, "files/2024/123.txt"), "text");
  await fs.promises.symlink("files/2024/123.txt", join(r, "file-sym.txt"));
  expect(await fs.promises.readlink(join(r, "file-sym.txt"))).toBe("files\\2024\\123.txt");
});

it("realpath async", async () => {
  const actual = join(tmpdirSync(), "fs-realpath.txt");
  try {
    unlinkSync(actual);
  } catch (e) {}

  symlinkSync(import.meta.path, actual);

  expect(await promises.realpath(actual)).toBe(realpathSync(import.meta.path));
  const tasks = new Array(500);
  for (let i = 0; i < 500; i++) {
    const current = actual + i;
    tasks[i] = promises.realpath(current).then(
      () => {
        throw new Error("should not get here");
      },
      e => {
        expect(e?.path).toBe(current);
      },
    );
  }
  await Promise.all(tasks);

  const { promise, resolve, reject } = Promise.withResolvers();
  fs.realpath(actual, (err, path) => {
    err ? reject(err) : resolve(path);
  });
  expect(await promise).toBe(realpathSync(import.meta.path));
}, 30_000);

describe("stat", () => {
  it("file metadata is correct", () => {
    const fileStats = statSync(join(import.meta.dir, "fs-stream.js"));
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(true);
    expect(fileStats.isDirectory()).toBe(false);

    triggerDOMJIT(fileStats, fileStats.isFile, true);
    triggerDOMJIT(fileStats, fileStats.isDirectory, false);
    triggerDOMJIT(fileStats, fileStats.isSymbolicLink, false);
  });

  it("folder metadata is correct", () => {
    const path = join(import.meta.dir, "../../../../test");
    const fileStats = statSync(path);
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(false);
    expect(fileStats.isDirectory()).toBe(true);
    expect(typeof fileStats.dev).toBe("number");
    expect(typeof fileStats.ino).toBe("number");
    expect(typeof fileStats.mode).toBe("number");
    expect(typeof fileStats.nlink).toBe("number");
    expect(typeof fileStats.uid).toBe("number");
    expect(typeof fileStats.gid).toBe("number");
    expect(typeof fileStats.rdev).toBe("number");
    expect(typeof fileStats.size).toBe("number");
    expect(typeof fileStats.blksize).toBe("number");
    expect(typeof fileStats.blocks).toBe("number");
    expect(typeof fileStats.atimeMs).toBe("number");
    expect(typeof fileStats.mtimeMs).toBe("number");
    expect(typeof fileStats.ctimeMs).toBe("number");
    expect(typeof fileStats.birthtimeMs).toBe("number");
    expect(typeof fileStats.atime).toBe("object");
    expect(typeof fileStats.mtime).toBe("object");
    expect(typeof fileStats.ctime).toBe("object");
    expect(typeof fileStats.birthtime).toBe("object");

    triggerDOMJIT(fileStats, fileStats.isFile, false);
    triggerDOMJIT(fileStats, fileStats.isDirectory, true);
    triggerDOMJIT(fileStats, fileStats.isSymbolicLink, false);
  });

  it("stat returns ENOENT", () => {
    try {
      statSync(`${tmpdir()}/doesntexist`);
      throw "statSync should throw";
    } catch (e: any) {
      expect(e.code).toBe("ENOENT");
    }

    try {
      statSync("");
      throw "statSync should throw";
    } catch (e: any) {
      expect(e.code).toBe("ENOENT");
    }
  });
});

describe("exist", () => {
  it("should return false with invalid path", () => {
    expect(existsSync("/pathNotExist")).toBe(false);
  });

  it("should return false with empty string", () => {
    expect(existsSync("")).toBe(false);
  });
});

describe("fs.exists", () => {
  it("should throw TypeError with invalid argument", done => {
    let err = undefined;
    try {
      // @ts-ignore
      fs.exists(import.meta.path);
    } catch (e) {
      err = e;
    }
    try {
      expect(err).not.toBeUndefined();
      expect(err).toBeInstanceOf(TypeError);
      // @ts-ignore
      expect(err.code).toStrictEqual("ERR_INVALID_ARG_TYPE");
      done();
    } catch (e) {
      done(e);
    }
  });
  it("should return false with invalid path", done => {
    fs.exists(`${tmpdir()}/test-fs-exists-${Date.now()}`, exists => {
      try {
        expect(exists).toBe(false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });
  it("should return true with existed path", done => {
    fs.exists(import.meta.path, exists => {
      try {
        expect(exists).toBe(true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });
  it("should work with util.promisify when path exists", async () => {
    const fsexists = promisify(fs.exists);
    expect(await fsexists(import.meta.path)).toBe(true);
  });
  it("should work with util.promisify when path doesn't exist", async () => {
    const fsexists = promisify(fs.exists);
    expect(await fsexists(`${tmpdir()}/test-fs-exists-${Date.now()}`)).toBe(false);
  });
});

describe("rm", () => {
  it("removes a file", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.txt`;
    writeFileSync(path, "File written successfully", "utf8");
    expect(existsSync(path)).toBe(true);
    rmSync(path);
    expect(existsSync(path)).toBe(false);
  });

  it("removes a dir", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir`;
    try {
      mkdirSync(path);
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmSync(path, { recursive: true });
    expect(existsSync(path)).toBe(false);
  });

  it("removes a dir recursively", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir/foo/bar`;
    try {
      mkdirSync(path, { recursive: true });
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmSync(join(path, "../../"), { recursive: true });
    expect(existsSync(path)).toBe(false);
  });

  // On Windows a leading-separator, drive-less path like "/foo/bar" is
  // "rooted" and must be resolved against the cwd's drive. existsSync/
  // statSync/unlinkSync all do this; recursive rmSync must agree
  // or cleanup helpers (rmSync(dir, { recursive: true, force: true })) silently
  // no-op on directories existsSync just said were there.
  //
  // Derive the driveless-but-rooted path from tmpdir() so all writes stay
  // inside the existing temp area instead of creating <drive>:\tmp at the
  // drive root. Only meaningful when cwd and tmpdir share a drive (always
  // true on CI); otherwise the driveless path resolves to a different
  // physical location, so skip.
  const cwdDrive = process.cwd().slice(0, 2);
  const tmpDrive = tmpdir().slice(0, 2);
  const sameDriveAsCwd = isWindows && cwdDrive.toLowerCase() === tmpDrive.toLowerCase();
  const drivelessTmp = tmpdir()
    .replace(/^[a-zA-Z]:/, "")
    .replaceAll("\\", "/");

  it.skipIf(!sameDriveAsCwd)("rmSync recursive agrees with existsSync for rooted POSIX-style paths", () => {
    const dir = `${drivelessTmp}/bun-rm-posix-path-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dir + "/inner.txt", "x");
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("rmdir", () => {
  it("does not remove a file", done => {
    const path = `${tmpdir()}/${Date.now()}.rm.txt`;
    writeFileSync(path, "File written successfully", "utf8");
    expect(existsSync(path)).toBe(true);
    rmdir(path, err => {
      try {
        expect(err).toBeDefined();
        expect("ENOENT ENOTDIR EPERM").toContain(err!.code);
        expect(existsSync(path)).toBe(true);
      } catch (e) {
        return done(e);
      } finally {
        done();
      }
    });
  });

  it("removes a dir", done => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir`;
    try {
      mkdirSync(path);
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmdir(path, err => {
      if (err) return done(err);
      expect(existsSync(path)).toBe(false);
      done();
    });
  });

  it("removes a dir x 512", async () => {
    var queue = new Array(512);
    var paths = new Array(512);
    for (let i = 0; i < 512; i++) {
      const path = `${tmpdir()}/${Date.now()}.rm.dir${i}`;
      try {
        mkdirSync(path);
      } catch (e) {}
      paths[i] = path;
      queue[i] = promises.rmdir(path);
    }

    await Promise.all(queue);

    for (let i = 0; i < 512; i++) {
      expect(existsSync(paths[i])).toBe(false);
    }
  });
  it("does not remove a dir with a file in it", async () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir`;
    try {
      mkdirSync(path);
      writeFileSync(`${path}/file.txt`, "File written successfully", "utf8");
    } catch (e) {}
    expect(existsSync(path + "/file.txt")).toBe(true);
    try {
      await promises.rmdir(path);
    } catch (err) {
      expect("ENOTEMPTY EPERM").toContain(err!.code);
    }

    expect(existsSync(path + "/file.txt")).toBe(true);

    await expect(promises.rmdir(path, { recursive: true })).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
    await promises.rm(path, { recursive: true, force: true });
    expect(existsSync(path + "/file.txt")).toBe(false);
  });
  it("throws for recursive: true like node", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir/foo/bar`;
    try {
      mkdirSync(path, { recursive: true });
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    expect(() => {
      rmdir(join(path, "../../"), { recursive: true }, () => {});
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
    rmSync(join(path, "../../"), { recursive: true, force: true });
    expect(existsSync(path)).toBe(false);
  });
});

describe("rmdirSync", () => {
  it("does not remove a file", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.txt`;
    writeFileSync(path, "File written successfully", "utf8");
    expect(existsSync(path)).toBe(true);
    expect(() => {
      rmdirSync(path);
    }).toThrow();
    expect(existsSync(path)).toBe(true);
  });
  it("removes a dir", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir`;
    try {
      mkdirSync(path);
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmdirSync(path);
    expect(existsSync(path)).toBe(false);
  });
  it("throws for recursive: true like node", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir/foo/bar`;
    try {
      mkdirSync(path, { recursive: true });
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    expect(() => rmdirSync(join(path, "../../"), { recursive: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    rmSync(join(path, "../../"), { recursive: true, force: true });
    expect(existsSync(path)).toBe(false);
  });
});

describe("createReadStream", () => {
  it("works (1 chunk)", async () => {
    return await new Promise((resolve, reject) => {
      var stream = createReadStream(import.meta.dir + "/readFileSync.txt", {});

      stream.on("error", e => {
        reject(e);
      });

      stream.on("data", chunk => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.length).toBe("File read successfully".length);
        expect(chunk.toString()).toBe("File read successfully");
      });
      stream.on("close", () => {
        resolve(true);
      });
    });
  });

  it("works (highWaterMark 1)", async () => {
    var stream = createReadStream(import.meta.dir + "/readFileSync.txt", {
      highWaterMark: 1,
    });

    var data = readFileSync(import.meta.dir + "/readFileSync.txt", "utf8");
    var i = 0;
    return await new Promise(resolve => {
      stream.on("data", chunk => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.length).toBe(1);
        expect(chunk.toString()).toBe(data.slice(i, i + 1));
        i++;
      });

      stream.on("end", () => {
        expect(i).toBe(data.length);
        resolve(true);
      });
    });
  });

  it("works (highWaterMark 512)", async () => {
    var stream = createReadStream(import.meta.dir + "/readLargeFileSync.txt", {
      highWaterMark: 512,
    });

    var data = readFileSync(import.meta.dir + "/readLargeFileSync.txt", "utf8");
    var i = 0;
    return await new Promise(resolve => {
      stream.on("data", chunk => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.length).toBeLessThanOrEqual(512);
        expect(chunk.toString()).toBe(data.slice(i, i + 512));
        i += 512;
      });

      stream.on("end", () => {
        resolve(true);
      });
    });
  });

  it.skip("works (512 chunk)", async () => {
    var stream = createReadStream(import.meta.dir + "/readLargeFileSync.txt", {
      highWaterMark: 512,
    });

    var data = readFileSync(import.meta.dir + "/readLargeFileSync.txt", "utf8");
    var i = 0;
    return await new Promise(resolve => {
      stream.on("data", chunk => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.length).toBe(512);
        expect(chunk.toString()).toBe(data.slice(i, i + 512));
        i += 512;
      });

      stream.on("end", () => {
        resolve(true);
      });
    });
  });

  it.skip("works with larger highWaterMark (1024 chunk)", async () => {
    var stream = createReadStream(import.meta.dir + "/readLargeFileSync.txt", {
      highWaterMark: 1024,
    });

    var data = readFileSync(import.meta.dir + "/readLargeFileSync.txt", "utf8");
    var i = 0;
    return await new Promise(resolve => {
      stream.on("data", chunk => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.length).toBe(1024);
        expect(chunk.toString()).toBe(data.slice(i, i + 1024));
        i += 1024;
      });

      stream.on("end", () => {
        resolve(true);
      });
    });
  });

  it("works with very large file", async () => {
    const tempFile = tmpdir() + "/" + "large-file" + Date.now() + ".txt";
    await Bun.write(Bun.file(tempFile), "big data big data big data".repeat(10000));
    var stream = createReadStream(tempFile, {
      highWaterMark: 512,
    });

    var data = readFileSync(tempFile, "utf8");
    var i = 0;
    return await new Promise(resolve => {
      stream.on("data", chunk => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.toString()).toBe(data.slice(i, i + chunk.length));
        i += chunk.length;
      });
      stream.on("end", () => {
        expect(i).toBe("big data big data big data".repeat(10000).length);
        rmSync(tempFile);
        resolve(true);
      });
    });
  });

  it("should emit open", done => {
    const ws = createReadStream(join(import.meta.dir, "readFileSync.txt"));
    ws.on("open", data => {
      expect(data).toBeDefined();
      done();
    });
  });

  it("should call close callback", done => {
    const ws = createReadStream(join(import.meta.dir, "readFileSync.txt"));
    ws.close(err => {
      expect(err).toBeDefined();
      expect(err?.message).toContain("Premature close");
      done();
    });
  });

  it(
    "correctly handles file descriptors with an offset",
    done => {
      const path = `${tmpdir()}/bun-fs-createReadStream-${Date.now()}.txt`;
      const fd = fs.openSync(path, "w+");

      const stream = fs.createReadStream("", { fd: fd, start: 2 });
      stream.on("data", chunk => {
        expect(chunk.toString()).toBe("llo, world!");
        done();
      });
      stream.on("error", done);

      fs.writeSync(fd, "Hello, world!");
    },
    { timeout: 100 },
  );

  // https://github.com/oven-sh/bun/issues/30919
  it("async iterator rejects with ERR_STREAM_PREMATURE_CLOSE when destroy() is called during iteration", async () => {
    const stream = createReadStream(join(import.meta.dir, "readFileSync.txt"));

    let chunks = 0;
    let caught: any = undefined;
    try {
      for await (const _ of stream) {
        chunks++;
        stream.destroy();
      }
    } catch (err) {
      caught = err;
    }

    expect(chunks).toBe(1);
    expect(caught).toBeDefined();
    expect(caught?.code).toBe("ERR_STREAM_PREMATURE_CLOSE");
  });

  // https://github.com/oven-sh/bun/pull/30920
  it("emits 'close' and releases fd with { start: 0, autoClose: true }", async () => {
    const stream = createReadStream(join(import.meta.dir, "readFileSync.txt"), { start: 0, autoClose: true });
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    stream.on("data", () => {});
    stream.on("error", reject);
    stream.on("close", () => resolve());

    await promise;
    expect(stream.destroyed).toBe(true);
    expect(stream.closed).toBe(true);
    expect(stream.fd).toBeNull();
  });
});

describe("fs.WriteStream", () => {
  it("should be exported", () => {
    expect(fs.WriteStream).toBeDefined();
  });

  it("should be constructable", () => {
    // @ts-ignore-next-line
    const stream = new fs.WriteStream("test.txt");
    expect(stream instanceof fs.WriteStream).toBe(true);
  });

  it("should be able to write to a file", done => {
    const pathToDir = `${tmpdir()}/${Date.now()}`;
    mkdirForce(pathToDir);
    const path = join(pathToDir, `fs-writestream-test.txt`);

    // @ts-ignore-next-line
    const stream = new fs.WriteStream(path, { flags: "w+" });
    stream.write("Test file written successfully");
    stream.end();

    stream.on("error", e => {
      done(e instanceof Error ? e : new Error(e));
    });

    stream.on("finish", () => {
      expect(readFileSync(path, "utf8")).toBe("Test file written successfully");
      done();
    });
  });

  it("should work if re-exported by name", () => {
    // @ts-ignore-next-line
    const stream = new WriteStream_("test.txt");
    expect(stream instanceof WriteStream_).toBe(true);
    expect(stream instanceof WriteStreamStar_).toBe(true);
    expect(stream instanceof fs.WriteStream).toBe(true);
  });

  it("should work if re-exported by name, called without new", () => {
    // @ts-ignore-next-line
    const stream = WriteStream_("test.txt");
    expect(stream instanceof WriteStream_).toBe(true);
    expect(stream instanceof WriteStreamStar_).toBe(true);
    expect(stream instanceof fs.WriteStream).toBe(true);
  });

  it("should work if re-exported, as export * from ...", () => {
    // @ts-ignore-next-line
    const stream = new WriteStreamStar_("test.txt");
    expect(stream instanceof WriteStream_).toBe(true);
    expect(stream instanceof WriteStreamStar_).toBe(true);
    expect(stream instanceof fs.WriteStream).toBe(true);
  });

  it("should work if re-exported, as export * from..., called without new", () => {
    // @ts-ignore-next-line
    const stream = WriteStreamStar_("test.txt");
    expect(stream instanceof WriteStream_).toBe(true);
    expect(stream instanceof WriteStreamStar_).toBe(true);
    expect(stream instanceof fs.WriteStream).toBe(true);
  });

  it("should be able to write to a file with re-exported WriteStream", done => {
    const pathToDir = `${tmpdir()}/${Date.now()}`;
    mkdirForce(pathToDir);
    const path = join(pathToDir, `fs-writestream-re-exported-test.txt`);
    // @ts-ignore-next-line
    const stream = new WriteStream_(path, { flags: "w+" });
    stream.write("Test file written successfully");
    stream.end();

    stream.on("error", e => {
      done(e instanceof Error ? e : new Error(e));
    });

    stream.on("finish", () => {
      expect(readFileSync(path, "utf8")).toBe("Test file written successfully");
      done();
    });
  });

  it("should use fd if provided", () => {
    const path = join(tmpdir(), `not-used-${Date.now()}.txt`);
    expect(existsSync(path)).toBe(false);
    const ws = new WriteStream_(path, { fd: 2 });
    // @ts-ignore-next-line
    expect(ws.fd).toBe(2);
    expect(existsSync(path)).toBe(false);
  });
});

describe("fs.ReadStream", () => {
  it("should be exported", () => {
    expect(fs.ReadStream).toBeDefined();
  });

  it("should be constructable", () => {
    // @ts-ignore-next-line
    const stream = new fs.ReadStream("test.txt");
    expect(stream instanceof fs.ReadStream).toBe(true);
  });

  it("should be able to read from a file", done => {
    const pathToDir = `${tmpdir()}/${Date.now()}`;
    mkdirForce(pathToDir);
    const path = join(pathToDir, `fs-readstream-test.txt`);

    writeFileSync(path, "Test file written successfully", {
      encoding: "utf8",
      flag: "w+",
    });
    // @ts-ignore-next-line
    const stream = new fs.ReadStream(path);
    stream.setEncoding("utf8");
    stream.on("error", e => {
      done(e instanceof Error ? e : new Error(e));
    });

    let data = "";

    stream.on("data", chunk => {
      data += chunk;
    });

    stream.on("end", () => {
      expect(data).toBe("Test file written successfully");
      done();
    });
  });

  it("should work if re-exported by name", () => {
    // @ts-ignore-next-line
    const stream = new ReadStream_("test.txt");
    expect(stream instanceof ReadStream_).toBe(true);
    expect(stream instanceof ReadStreamStar_).toBe(true);
    expect(stream instanceof fs.ReadStream).toBe(true);
  });

  it("should work if re-exported by name, called without new", () => {
    // @ts-ignore-next-line
    const stream = ReadStream_("test.txt");
    expect(stream instanceof ReadStream_).toBe(true);
    expect(stream instanceof ReadStreamStar_).toBe(true);
    expect(stream instanceof fs.ReadStream).toBe(true);
  });

  it("should work if re-exported as export * from ...", () => {
    // @ts-ignore-next-line
    const stream = new ReadStreamStar_("test.txt");
    expect(stream instanceof ReadStreamStar_).toBe(true);
    expect(stream instanceof ReadStream_).toBe(true);
    expect(stream instanceof fs.ReadStream).toBe(true);
  });

  it("should work if re-exported as export * from ..., called without new", () => {
    // @ts-ignore-next-line
    const stream = ReadStreamStar_("test.txt");
    expect(stream instanceof ReadStreamStar_).toBe(true);
    expect(stream instanceof ReadStream_).toBe(true);
    expect(stream instanceof fs.ReadStream).toBe(true);
  });

  it("should be able to read from a file, with re-exported ReadStream", done => {
    const pathToDir = `${tmpdir()}/${Date.now()}`;
    mkdirForce(pathToDir);
    const path = join(pathToDir, `fs-readstream-re-exported-test.txt`);

    writeFileSync(path, "Test file written successfully", {
      encoding: "utf8",
      flag: "w+",
    });

    // @ts-ignore-next-line
    const stream = new ReadStream_(path);
    stream.setEncoding("utf8");
    stream.on("error", e => {
      done(e instanceof Error ? e : new Error(e));
    });

    let data = "";

    stream.on("data", chunk => {
      data += chunk;
    });

    stream.on("end", () => {
      expect(data).toBe("Test file written successfully");
      done();
    });
  });

  it("should use fd if provided", () => {
    const path = join(tmpdir(), `not-used-${Date.now()}.txt`);
    expect(existsSync(path)).toBe(false);
    // @ts-ignore-next-line
    const ws = new ReadStream_(path, {
      fd: 0,
    });
    // @ts-ignore-next-line
    expect(ws.fd).toBe(0);
    expect(existsSync(path)).toBe(false);
  });
});

describe("createWriteStream", () => {
  it.todoIf(isBroken && isWindows)("simple write stream finishes", async () => {
    const streamPath = join(tmpdirSync(), "create-write-stream.txt");
    const { promise: done, resolve, reject } = Promise.withResolvers();

    const stream = createWriteStream(streamPath);
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.write("Test file written successfully");
    stream.end();

    await done;
    expect(readFileSync(streamPath, "utf8")).toBe("Test file written successfully");
  });

  it("writing null throws ERR_STREAM_NULL_VALUES", async () => {
    const streamPath = join(tmpdirSync(), "create-write-stream-nulls.txt");
    const stream = createWriteStream(streamPath);
    expect.toThrowWithCode(() => stream.write(null), "ERR_STREAM_NULL_VALUES");
  });

  it("writing null throws ERR_STREAM_NULL_VALUES (objectMode: true)", async () => {
    const streamPath = join(tmpdirSync(), "create-write-stream-nulls-object-mode.txt");
    const stream = createWriteStream(streamPath, {
      // @ts-ignore-next-line
      objectMode: true,
    });
    expect.toThrowWithCode(() => stream.write(null), "ERR_STREAM_NULL_VALUES");
  });

  it("writing false throws ERR_INVALID_ARG_TYPE", async () => {
    const streamPath = join(tmpdirSync(), "create-write-stream-false.txt");
    const stream = createWriteStream(streamPath);
    expect.toThrowWithCode(() => stream.write(false), "ERR_INVALID_ARG_TYPE");
  });

  it("writing false throws ERR_INVALID_ARG_TYPE (objectMode: true)", async () => {
    const streamPath = join(tmpdirSync(), "create-write-stream-false-object-mode.txt");
    const stream = createWriteStream(streamPath, {
      // @ts-ignore-next-line
      objectMode: true,
    });
    expect.toThrowWithCode(() => stream.write(false), "ERR_INVALID_ARG_TYPE");
  });

  it("writing in append mode should not truncate the file", async () => {
    const streamPath = join(tmpdirSync(), "create-write-stream-append.txt");
    const stream = createWriteStream(streamPath, {
      // @ts-ignore-next-line
      flags: "a",
    });

    const { promise: done1, resolve: resolve1, reject: reject1 } = Promise.withResolvers();
    stream.on("error", reject1);
    stream.on("finish", resolve1);
    stream.write("first line\n");
    stream.end();
    await done1;

    const { promise: done2, resolve: resolve2, reject: reject2 } = Promise.withResolvers();
    const stream2 = createWriteStream(streamPath, { flags: "a" });
    stream2.on("error", reject2);
    stream2.on("finish", resolve2);
    stream2.write("second line\n");
    stream2.end();
    await done2;

    expect(readFileSync(streamPath, "utf8")).toBe("first line\nsecond line\n");
  });

  it("should emit open and call close callback", done => {
    const ws = createWriteStream(join(tmpdir(), "fs"));
    ws.on("open", data => {
      expect(data).toBeDefined();
      done();
    });
  });

  it("should call close callback", done => {
    const ws = createWriteStream(join(tmpdir(), "fs"));
    ws.close(err => {
      expect(err).toBeUndefined();
      done();
    });
  });

  it("should call callbacks in the correct order", done => {
    const ws = createWriteStream(join(tmpdir(), "fs"));
    let counter1 = 0;
    ws.on("open", () => {
      expect(counter1++).toBe(0);
    });

    ws.close(() => {
      expect(counter1++).toBe(1);
      if (counter2 === 2) {
        done();
      }
    });

    let counter2 = 0;
    const rs = createReadStream(join(import.meta.dir, "readFileSync.txt"));
    rs.on("open", () => {
      expect(counter2++).toBe(0);
    });

    rs.close(() => {
      expect(counter2++).toBe(1);
      if (counter1 === 2) {
        done();
      }
    });
  });

  // https://github.com/oven-sh/bun/issues/31763
  it("coalesces many small writes via _writev (issue #31763)", async () => {
    const streamPath = join(tmpdirSync(), "writev-batching.bin");
    const stream = createWriteStream(streamPath);

    // fs.WriteStream exposes a working _writev; the regression disabled it.
    expect(typeof stream._writev).toBe("function");

    // Count how many chunks each drain path consumes.
    const writevSpy = spyOn(stream, "_writev");

    const CHUNK_COUNT = 5000; // comfortably past IOV_MAX so batching is forced
    const chunk = Buffer.from("0123456789\n"); // 11 bytes
    let written = 0;

    const { promise: done, resolve, reject } = Promise.withResolvers<void>();
    stream.on("error", reject);
    stream.on("finish", resolve);

    const pump = () => {
      while (written < CHUNK_COUNT) {
        written++;
        if (!stream.write(chunk)) {
          stream.once("drain", pump);
          return;
        }
      }
      stream.end();
    };
    pump();
    await done;

    // Output is byte-for-byte correct regardless of how it was batched.
    expect(statSync(streamPath).size).toBe(CHUNK_COUNT * chunk.length);
    expect(readFileSync(streamPath)).toEqual(Buffer.concat(new Array(CHUNK_COUNT).fill(chunk)));

    // _writev must have been used, and it must have handled batches larger
    // than IOV_MAX without erroring.
    expect(writevSpy).toHaveBeenCalled();
    const maxBatch = Math.max(...writevSpy.mock.calls.map(args => (args[0] as unknown[]).length));
    expect(maxBatch).toBeGreaterThan(1024);
  });

  // https://github.com/oven-sh/bun/issues/31763
  // With no `start`, the retry position must stay undefined, not
  // `undefined + bytesWritten === NaN` (coerced to offset 0 by the binding).
  it.each(["write", "writev"])("partial %s retry does not corrupt the file (issue #31763)", async method => {
    const streamPath = join(tmpdirSync(), `partial-${method}.bin`);
    const payload = Buffer.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const positions: unknown[] = [];
    let first = true;

    // Simulate a short write on the first syscall, then a clean retry,
    // delegating to the real fs so bytes actually land on disk.
    const customFs: any = {
      open: fs.open,
      close: fs.close,
      write(fd, data, offset, length, position, cb) {
        positions.push(position);
        if (first) {
          first = false;
          const half = Math.floor(length / 2);
          fs.write(fd, data, offset, half, position, (err, written) => cb(err, written, data));
          return;
        }
        fs.write(fd, data, offset, length, position, cb);
      },
      writev(fd, chunks, position, cb) {
        positions.push(position);
        if (first) {
          first = false;
          // Write only the first chunk, report it as a partial write.
          fs.writev(fd, [chunks[0]], position, (err, written) => cb(err, written, chunks));
          return;
        }
        fs.writev(fd, chunks, position, cb);
      },
    };

    const stream = createWriteStream(streamPath, { fs: customFs } as any);
    const { promise: done, resolve, reject } = Promise.withResolvers<void>();
    stream.on("error", reject);
    stream.on("finish", resolve);
    if (method === "writev") {
      // Force the buffered writev path with a cork + multiple writes.
      stream.cork();
      stream.write(payload.subarray(0, 10));
      stream.write(payload.subarray(10));
      stream.uncork();
      stream.end();
    } else {
      stream.end(payload);
    }
    await done;

    // A NaN -> 0 retry offset would overwrite the head; the bytes must be intact.
    expect(readFileSync(streamPath)).toEqual(payload);
    // The retry must never pass NaN as the position.
    expect(positions.some(p => typeof p === "number" && Number.isNaN(p))).toBe(false);
  });
});

describe("fs.writev past IOV_MAX", () => {
  // https://github.com/oven-sh/bun/issues/31763
  // writev(2)/pwritev(2) reject more than IOV_MAX (1024) iovecs with EINVAL;
  // Bun must batch the syscall so fs.writev behaves like Node's.
  const makeBuffers = (n: number) => {
    const buffers = new Array<Buffer>(n);
    for (let i = 0; i < n; i++) buffers[i] = Buffer.from([i & 0xff]);
    return buffers;
  };

  it.each([1023, 1024, 1025, 2000, 5000])("writevSync handles %d buffers", count => {
    const p = join(tmpdirSync(), `writev-sync-${count}.bin`);
    const fd = openSync(p, "w");
    try {
      const buffers = makeBuffers(count);
      expect(writevSync(fd, buffers)).toBe(count);
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(p)).toEqual(Buffer.concat(makeBuffers(count)));
  });

  it("writevSync with a position handles more than IOV_MAX buffers", () => {
    const p = join(tmpdirSync(), "pwritev-sync.bin");
    const fd = openSync(p, "w");
    const prefix = "prefix";
    try {
      writeSync(fd, prefix, 0);
      const buffers = makeBuffers(3000);
      expect(writevSync(fd, buffers, prefix.length)).toBe(3000);
    } finally {
      closeSync(fd);
    }
    const out = readFileSync(p);
    expect(out.subarray(0, prefix.length).toString()).toBe(prefix);
    expect(out.subarray(prefix.length)).toEqual(Buffer.concat(makeBuffers(3000)));
  });

  it("async fs.writev handles more than IOV_MAX buffers", async () => {
    const p = join(tmpdirSync(), "writev-async.bin");
    const fd = openSync(p, "w");
    let written: number;
    try {
      const buffers = makeBuffers(2500);
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      fs.writev(fd, buffers, (err, w) => (err ? reject(err) : resolve(w)));
      written = await promise;
    } finally {
      closeSync(fd);
    }
    expect(written).toBe(2500);
    expect(readFileSync(p)).toEqual(Buffer.concat(makeBuffers(2500)));
  });
});

// readv(2)/preadv(2) reject more than IOV_MAX (1024) iovecs with EINVAL.
// Node (libuv) caps the batch and returns a short read instead of erroring;
// Windows reads every buffer through libuv, so these POSIX tests don't apply.
describe.skipIf(isWindows)("fs.readv past IOV_MAX", () => {
  const COUNT = 1025;
  const IOV_MAX = 1024;

  const makeFile = (name: string) => {
    const p = join(tmpdirSync(), name);
    writeFileSync(p, Buffer.concat(Array.from({ length: COUNT }, (_, i) => Buffer.from([i & 0xff]))));
    return p;
  };
  const makeBuffers = () => Array.from({ length: COUNT }, () => Buffer.alloc(1));

  it("readvSync caps at IOV_MAX buffers and returns a short read", () => {
    const fd = openSync(makeFile("readv-sync.bin"), "r");
    const buffers = makeBuffers();
    try {
      // First call short-reads at the cap; a second call drains the rest.
      expect(readvSync(fd, buffers)).toBe(IOV_MAX);
      expect(readvSync(fd, buffers.slice(IOV_MAX))).toBe(COUNT - IOV_MAX);
    } finally {
      closeSync(fd);
    }
    expect(Buffer.concat(buffers)).toEqual(
      Buffer.concat(Array.from({ length: COUNT }, (_, i) => Buffer.from([i & 0xff]))),
    );
  });

  it("readvSync with a position caps at IOV_MAX buffers", () => {
    const fd = openSync(makeFile("preadv-sync.bin"), "r");
    const buffers = makeBuffers();
    try {
      expect(readvSync(fd, buffers, 1)).toBe(IOV_MAX);
    } finally {
      closeSync(fd);
    }
    expect(buffers[0]).toEqual(Buffer.from([1]));
    expect(buffers[IOV_MAX - 1]).toEqual(Buffer.from([IOV_MAX & 0xff]));
  });

  it("async fs.readv caps at IOV_MAX buffers", async () => {
    const fd = openSync(makeFile("readv-async.bin"), "r");
    let bytesRead: number;
    try {
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      fs.readv(fd, makeBuffers(), (err, n) => (err ? reject(err) : resolve(n)));
      bytesRead = await promise;
    } finally {
      closeSync(fd);
    }
    expect(bytesRead).toBe(IOV_MAX);
  });
});

describe("fs/promises", () => {
  const { exists, mkdir, readFile, rm, rmdir, stat, writeFile } = promises;

  it("should not segfault on exception", async () => {
    try {
      await stat("foo/bar");
    } catch (e) {}
  });

  it("readFile", async () => {
    const data = await readFile(import.meta.dir + "/readFileSync.txt", "utf8");
    expect(data).toBe("File read successfully");
  });

  it("writeFile", async () => {
    const path = `${tmpdir()}/fs.test.ts/${Date.now()}.writeFile.txt`;
    await writeFile(path, "File written successfully");
    expect(readFileSync(path, "utf8")).toBe("File written successfully");
  });

  it("readdir()", async () => {
    const files = await promises.readdir(import.meta.dir);
    expect(files.length).toBeGreaterThan(0);
  });

  it.concurrent(
    "readdir(path, {recursive: true}) produces the same result as Node.js",
    async () => {
      const full = resolve(import.meta.dir, "../");
      const [bun, subprocess] = await Promise.all([
        (async function () {
          const files = await promises.readdir(full, { recursive: true });
          files.sort();
          return files;
        })(),
        (async function () {
          const subprocess = Bun.spawn({
            cmd: [
              "node",
              "-e",
              `process.stdout.write(JSON.stringify(require("fs").readdirSync(${JSON.stringify(
                full,
              )}, { recursive: true }).sort()), null, 2)`,
            ],
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "inherit",
            stdin: "inherit",
          });
          await subprocess.exited;
          return subprocess;
        })(),
      ]);

      expect(subprocess.exitCode).toBe(0);
      const text = await subprocess.stdout.text();
      const node = JSON.parse(text);
      expect(bun).toEqual(node as string[]);
    },
    100000,
  );

  it.concurrent(
    "readdir(path, {withFileTypes: true}) produces the same result as Node.js",
    async () => {
      const full = resolve(import.meta.dir, "../");
      const [bun, subprocess] = await Promise.all([
        (async function () {
          const files = await promises.readdir(full, { withFileTypes: true });
          files.sort();
          return files;
        })(),
        (async function () {
          const subprocess = Bun.spawn({
            cmd: [
              "node",
              "-e",
              `process.stdout.write(JSON.stringify(require("fs").readdirSync(${JSON.stringify(
                full,
              )}, { withFileTypes: true }).map(v => ({ path: v.parentPath ?? v.path, name: v.name })).sort()), null, 2)`,
            ],
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "inherit",
            stdin: "inherit",
          });
          await subprocess.exited;
          return subprocess;
        })(),
      ]);

      expect(subprocess.exitCode).toBe(0);
      const text = await subprocess.stdout.text();
      const node = JSON.parse(text);
      expect(bun.length).toEqual(node.length);
      expect([...new Set(node.map(v => v.parentPath ?? v.path))]).toEqual([full]);
      expect([...new Set(bun.map(v => v.parentPath ?? v.path))]).toEqual([full]);
      expect(bun.map(v => join(v.parentPath ?? v.path, v.name)).sort()).toEqual(
        node.map(v => join(v.path, v.name)).sort(),
      );
    },
    100000,
  );

  it.concurrent(
    "readdir(path, {withFileTypes: true, recursive: true}) produces the same result as Node.js",
    async () => {
      const full = resolve(import.meta.dir, "../");
      const [bun, subprocess] = await Promise.all([
        (async function () {
          const files = await promises.readdir(full, { withFileTypes: true, recursive: true });
          files.sort((a, b) => a.path.localeCompare(b.path));
          return files;
        })(),
        (async function () {
          const subprocess = Bun.spawn({
            cmd: [
              "node",
              "-e",
              `process.stdout.write(JSON.stringify(require("fs").readdirSync(${JSON.stringify(
                full,
              )}, { withFileTypes: true, recursive: true }).map(v => ({ path: v.parentPath ?? v.path, name: v.name })).sort((a, b) => a.path.localeCompare(b.path))), null, 2)`,
            ],
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "inherit",
            stdin: "inherit",
          });
          await subprocess.exited;
          return subprocess;
        })(),
      ]);

      expect(subprocess.exitCode).toBe(0);
      const text = await subprocess.stdout.text();
      const node = JSON.parse(text);
      expect(bun.length).toEqual(node.length);
      expect(new Set(bun.map(v => v.parentPath ?? v.path))).toEqual(new Set(node.map(v => v.path)));
      expect(bun.map(v => join(v.parentPath ?? v.path, v.name)).sort()).toEqual(
        node.map(v => join(v.path, v.name)).sort(),
      );
    },
    100000,
  );

  it.concurrent(
    "readdirSync(path, {withFileTypes: true, recursive: true}) produces the same result as Node.js",
    async () => {
      const full = resolve(import.meta.dir, "../");
      const [bun, subprocess] = await Promise.all([
        (async function () {
          const files = readdirSync(full, { withFileTypes: true, recursive: true });
          files.sort((a, b) => a.path.localeCompare(b.path));
          return files;
        })(),
        (async function () {
          const subprocess = Bun.spawn({
            cmd: [
              "node",
              "-e",
              `process.stdout.write(JSON.stringify(require("fs").readdirSync(${JSON.stringify(
                full,
              )}, { withFileTypes: true, recursive: true }).map(v => ({ path: v.parentPath ?? v.path, name: v.name })).sort((a, b) => a.path.localeCompare(b.path))), null, 2)`,
            ],
            cwd: process.cwd(),
            stdout: "pipe",
            stderr: "inherit",
            stdin: "inherit",
          });
          await subprocess.exited;
          return subprocess;
        })(),
      ]);

      expect(subprocess.exitCode).toBe(0);
      const text = await subprocess.stdout.text();
      const node = JSON.parse(text);
      expect(bun.length).toEqual(node.length);
      expect(new Set(bun.map(v => v.parentPath ?? v.path))).toEqual(new Set(node.map(v => v.path)));
      expect(bun.map(v => join(v.parentPath ?? v.path, v.name)).sort()).toEqual(
        node.map(v => join(v.path, v.name)).sort(),
      );
    },
    100000,
  );

  for (let withFileTypes of [false, true] as const) {
    const iterCount = isDebug ? 16 : 200;
    const full = resolve(import.meta.dir, "../");

    const doIt = async () => {
      const maxFD = getMaxFD();

      await Promise.all(
        Array.from({ length: iterCount }, () => promises.readdir(full, { withFileTypes, recursive: true })),
      );

      const pending = new Array(iterCount);
      for (let i = 0; i < iterCount; i++) {
        pending[i] = promises.readdir(full, { recursive: true, withFileTypes });
      }

      const results = await Promise.all(pending);
      // Sort the results for determinism.
      if (withFileTypes) {
        for (let i = 0; i < iterCount; i++) {
          results[i].sort((a, b) => a.path.localeCompare(b.path));
        }
      } else {
        for (let i = 0; i < iterCount; i++) {
          results[i].sort();
        }
      }

      expect(results[0].length).toBeGreaterThan(0);
      for (let i = 1; i < iterCount; i++) {
        expect(results[i]).toEqual(results[0]);
      }

      if (!withFileTypes) {
        expect(results[0]).toContain(relative(full, import.meta.path));
      } else {
        expect(results[0][0].path).toEqual(full);
      }

      const newMaxFD = getMaxFD();

      // assert we do not leak file descriptors
      // but we might start some threads or create kqueue
      // so we should allow *some* increase
      expect(newMaxFD - maxFD).toBeLessThan(5);
    };

    const fail = async () => {
      const notfound = isWindows ? "C:\\notfound\\for\\sure" : "/notfound/for/sure";

      const maxFD = getMaxFD();

      const pending = new Array(iterCount);
      for (let i = 0; i < iterCount; i++) {
        pending[i] = promises.readdir(join(notfound, `${i}`), { recursive: true, withFileTypes });
      }

      const results = await Promise.allSettled(pending);
      for (let i = 0; i < iterCount; i++) {
        expect(results[i].status).toBe("rejected");
        expect(results[i].reason!.code).toBe("ENOENT");
        expect(results[i].reason!.path).toBe(join(notfound, `${i}`));
      }

      const newMaxFD = getMaxFD();
      expect(maxFD).toBe(newMaxFD); // assert we do not leak file descriptors
    };

    if (withFileTypes) {
      describe("withFileTypes", () => {
        it("readdir(path, {recursive: true} should work x 100", doIt, 10_000);
        it("readdir(path, {recursive: true} should fail x 100", fail, 10_000);
      });
    } else {
      it("readdir(path, {recursive: true} should work x 100", doIt, 10_000);
      it("readdir(path, {recursive: true} should fail x 100", fail, 10_000);
    }
  }

  for (let withFileTypes of [false, true] as const) {
    const warmup = 1;
    const iterCount = isDebug ? 4 : 200;
    const full = resolve(import.meta.dir, "../");

    const doIt = async () => {
      for (let i = 0; i < warmup; i++) {
        readdirSync(full, { withFileTypes });
      }

      const maxFD = getMaxFD();

      const results = new Array(iterCount);
      for (let i = 0; i < iterCount; i++) {
        results[i] = readdirSync(full, { recursive: true, withFileTypes });
      }

      for (let i = 0; i < iterCount; i++) {
        results[i].sort();
      }
      expect(results[0].length).toBeGreaterThan(0);
      for (let i = 1; i < iterCount; i++) {
        expect(results[i]).toEqual(results[0]);
      }

      if (!withFileTypes) {
        expect(results[0]).toContain(relative(full, import.meta.path));
      } else {
        expect(results[0][0].path).toEqual(full);
      }

      const newMaxFD = getMaxFD();
      expect(maxFD).toBe(newMaxFD); // assert we do not leak file descriptors
    };

    if (withFileTypes) {
      it("readdirSync(path, {recursive: true, withFileTypes: true} should work x 100", doIt, 10_000);
    } else {
      it("readdirSync(path, {recursive: true} should work x 100", doIt, 10_000);
    }
  }

  // Linux-only: uses /proc/self/fd/<n> to build entries whose relative path
  // from the readdir root reaches MAX_PATH_BYTES without ever handing a long
  // path to a single syscall. On Linux MAX_PATH_BYTES = 4096 and NAME_MAX = 255,
  // so 16 levels of 255-byte dir names puts the deepest relative path at 4095.
  it.skipIf(!isLinux).concurrent(
    "readdir(path, {recursive: true}) reports entries whose relative path reaches MAX_PATH_BYTES",
    async () => {
      const script = `
        const fs = require("fs");
        const root = process.env.DEEP_ROOT;
        const seg = Buffer.alloc(255, "d").toString();
        const longName = Buffer.alloc(255, "x").toString();
        let cur = fs.openSync(root, "r");
        for (let i = 0; i < 16; i++) {
          const base = "/proc/self/fd/" + cur;
          fs.mkdirSync(base + "/" + seg);
          const next = fs.openSync(base + "/" + seg, "r");
          fs.closeSync(cur);
          cur = next;
        }
        // cur = depth 16 (relative path 4095). Up one -> depth 15 (relative 3839).
        const d15 = fs.openSync("/proc/self/fd/" + cur + "/..", "r");
        fs.closeSync(cur);
        // At depth 15 the iterator sees three entries: the depth-16 dir (name
        // len 255), longName (file, len 255) and "short" (file, len 5). The
        // former two have relative paths of 4095 bytes from root.
        fs.writeFileSync("/proc/self/fd/" + d15 + "/" + longName, "");
        fs.writeFileSync("/proc/self/fd/" + d15 + "/short", "");
        fs.closeSync(d15);

        function report(label, entries) {
          const rel = entries.map(e => {
            if (typeof e === "string") return e;
            return require("path").join(e.parentPath, e.name).slice(root.length + 1);
          });
          const long = rel.filter(n => n.endsWith("/" + longName)).length;
          const deepDir = rel.filter(n => n.length === 4095 && n.endsWith("/" + seg)).length;
          const short = rel.filter(n => n.endsWith("/short")).length;
          console.log(JSON.stringify({ label, count: entries.length, long, deepDir, short }));
        }

        report("sync", fs.readdirSync(root, { recursive: true }));
        report("syncDirent", fs.readdirSync(root, { recursive: true, withFileTypes: true }));
        fs.promises.readdir(root, { recursive: true }).then(r => {
          report("async", r);
          return fs.promises.readdir(root, { recursive: true, withFileTypes: true });
        }).then(r => report("asyncDirent", r));
      `;
      using dir = tempDir("readdir-deep", {});
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, DEEP_ROOT: String(dir) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(l => JSON.parse(l));
      // 16 dirs + 2 files = 18 entries; every mode must see the depth-16 dir
      // and the 255-byte file whose relative paths are 4095 bytes.
      const want = { count: 18, long: 1, deepDir: 1, short: 1 };
      expect({ stderr, lines }).toEqual({
        stderr: "",
        lines: [
          { label: "sync", ...want },
          { label: "syncDirent", ...want },
          { label: "async", ...want },
          { label: "asyncDirent", ...want },
        ],
      });
      expect(exitCode).toBe(0);
    },
  );

  it("readdir() no args doesnt segfault", async () => {
    const fizz = [
      [],
      [Symbol("ok")],
      [Symbol("ok"), Symbol("ok")],
      [Symbol("ok"), Symbol("ok"), Symbol("ok")],
      [Infinity, -NaN, -Infinity],
      "\0\0\0\0",
      "\r\n",
    ];
    for (const args of fizz) {
      try {
        // check it doens't segfault when called with invalid arguments
        await promises.readdir(...(args as [any, ...any[]]));
      } catch (e) {
        // check that producing the error doesn't cause any crashes
        Bun.inspect(e);
      }
    }
  });

  describe("rmdir", () => {
    it("removes a file", async () => {
      const path = `${tmpdir()}/${Date.now()}.rm.txt`;
      await writeFile(path, "File written successfully", "utf8");
      expect(await exists(path)).toBe(true);
      try {
        await rmdir(path);
        expect(() => {}).toThrow();
      } catch (err: any) {
        expect("ENOTDIR EPERM ENOENT").toContain(err.code);
        expect(await exists(path)).toBe(true);
      }
    });

    it("removes a dir", async () => {
      const path = `${tmpdir()}/${Date.now()}.rm.dir`;
      try {
        await mkdir(path);
      } catch (e) {}
      expect(await exists(path)).toBe(true);
      await rmdir(path);
      expect(await exists(path)).toBe(false);
    });
    it("throws for recursive: true like node", async () => {
      const path = `${tmpdir()}/${Date.now()}.rm.dir/foo/bar`;
      try {
        await mkdir(path, { recursive: true });
      } catch (e) {}
      expect(await exists(path)).toBe(true);
      await expect(rmdir(join(path, "../../"), { recursive: true })).rejects.toMatchObject({
        code: "ERR_INVALID_ARG_VALUE",
      });
      await rm(join(path, "../../"), { recursive: true, force: true });
      expect(await exists(path)).toBe(false);
    });
  });

  it("opendir should have a path property, issue#4995", async () => {
    expect((await fs.promises.opendir(".")).path).toBe(".");

    const { promise, resolve } = Promise.withResolvers<Dir>();
    fs.opendir(".", (err, dir) => {
      resolve(dir);
    });

    expect((await promise).path).toBe(".");
  });
});

it("fstatSync(decimal)", () => {
  expect(() => fstatSync(eval("1.0"))).not.toThrow();
  expect(() => fstatSync(eval("0.0"))).not.toThrow();
  expect(() => fstatSync(eval("2.0"))).not.toThrow();
  expect(() => fstatSync(eval("-1.0"))).toThrow();
  expect(() => fstatSync(eval("Infinity"))).toThrow();
  expect(() => fstatSync(eval("-Infinity"))).toThrow();
  expect(() => fstatSync(2147483647 + 1)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" })); // > max int32 is not valid in most C APIs still.
  expect(() => fstatSync(2147483647)).toThrow(expect.objectContaining({ code: "EBADF" })); // max int32 is a valid fd
});

it("fstat on a large file", () => {
  var dest: string = "",
    fd;
  try {
    dest = `${tmpdir()}/fs.test.ts/${Math.trunc(Math.random() * 10000000000).toString(32)}.stat.txt`;
    mkdirSync(dirname(dest), { recursive: true });
    fd = openSync(dest, "w");

    // Instead of writing the actual bytes, we can use ftruncate to make a
    // hole-y file and extend it to the desired size This should generally avoid
    // the ENOSPC issue and avoid timeouts.
    ftruncateSync(fd, 5 * 1024 * 1024 * 1024);
    fdatasyncSync(fd);
    const stats = fstatSync(fd);
    expect(stats.size).toEqual(5 * 1024 * 1024 * 1024);
  } catch (error) {
    // TODO: Once `fs.statfsSync` is implemented, make sure that the buffer size
    // is small enough not to cause: ENOSPC: No space left on device.
    if (error.code === "ENOSPC") {
      console.warn("Skipping test 'fstat on a large file' because not enough disk space");
      return;
    }
    throw error;
  } finally {
    if (fd) closeSync(fd);
    unlinkSync(dest);
  }
}, 30_000);

it("fs.constants", () => {
  if (isWindows) {
    expect(constants).toEqual({
      UV_FS_SYMLINK_DIR: 1,
      UV_FS_SYMLINK_JUNCTION: 2,
      O_RDONLY: 0,
      O_WRONLY: 1,
      O_RDWR: 2,
      UV_DIRENT_UNKNOWN: 0,
      UV_DIRENT_FILE: 1,
      UV_DIRENT_DIR: 2,
      UV_DIRENT_LINK: 3,
      UV_DIRENT_FIFO: 4,
      UV_DIRENT_SOCKET: 5,
      UV_DIRENT_CHAR: 6,
      UV_DIRENT_BLOCK: 7,
      S_IFMT: 61440,
      S_IFREG: 32768,
      S_IFDIR: 16384,
      S_IFCHR: 8192,
      S_IFIFO: 4096,
      S_IFLNK: 40960,
      O_CREAT: 256,
      O_EXCL: 1024,
      UV_FS_O_FILEMAP: 536870912,
      O_TRUNC: 512,
      O_APPEND: 8,
      S_IRUSR: 256,
      S_IWUSR: 128,
      F_OK: 0,
      R_OK: 4,
      W_OK: 2,
      X_OK: 1,
      UV_FS_COPYFILE_EXCL: 1,
      COPYFILE_EXCL: 1,
      UV_FS_COPYFILE_FICLONE: 2,
      COPYFILE_FICLONE: 2,
      UV_FS_COPYFILE_FICLONE_FORCE: 4,
      COPYFILE_FICLONE_FORCE: 4,
      EXTENSIONLESS_FORMAT_JAVASCRIPT: 0,
      EXTENSIONLESS_FORMAT_WASM: 1,
    } as any);
    return;
  }
  expect(constants).toBeDefined();
  expect(constants.F_OK).toBeDefined();
  expect(constants.R_OK).toBeDefined();
  expect(constants.W_OK).toBeDefined();
  expect(constants.X_OK).toBeDefined();
  expect(constants.O_RDONLY).toBeDefined();
  expect(constants.O_WRONLY).toBeDefined();
  expect(constants.O_RDWR).toBeDefined();
  expect(constants.O_CREAT).toBeDefined();
  expect(constants.O_EXCL).toBeDefined();
  expect(constants.O_NOCTTY).toBeDefined();
  expect(constants.O_TRUNC).toBeDefined();
  expect(constants.O_APPEND).toBeDefined();
  expect(constants.O_DIRECTORY).toBeDefined();
  // expect(constants.O_NOATIME).toBeDefined();
  expect(constants.O_NOFOLLOW).toBeDefined();
  expect(constants.O_SYNC).toBeDefined();
  expect(constants.O_DSYNC).toBeDefined();
  if (process.platform === "darwin") expect(constants.O_SYMLINK).toBeDefined();
  // expect(constants.O_DIRECT).toBeDefined();
  expect(constants.O_NONBLOCK).toBeDefined();
  expect(constants.S_IFMT).toBeDefined();
  expect(constants.S_IFREG).toBeDefined();
  expect(constants.S_IFDIR).toBeDefined();
  expect(constants.S_IFCHR).toBeDefined();
  expect(constants.S_IFBLK).toBeDefined();
  expect(constants.S_IFIFO).toBeDefined();
  expect(constants.S_IFLNK).toBeDefined();
  expect(constants.S_IFSOCK).toBeDefined();
  expect(constants.S_IRWXU).toBeDefined();
  expect(constants.S_IRUSR).toBeDefined();
  expect(constants.S_IWUSR).toBeDefined();
  expect(constants.S_IXUSR).toBeDefined();
  expect(constants.S_IRWXG).toBeDefined();
  expect(constants.S_IRGRP).toBeDefined();
  expect(constants.S_IWGRP).toBeDefined();
  expect(constants.S_IXGRP).toBeDefined();
  expect(constants.S_IRWXO).toBeDefined();
  expect(constants.S_IROTH).toBeDefined();
  expect(constants.S_IWOTH).toBeDefined();
});

it("fs.promises.constants", () => {
  expect(promises.constants).toBeDefined();
  expect(promises.constants).toBe(fs.constants);
});

it("fs.Dirent", () => {
  expect(Dirent).toBeDefined();
});

it("fs.Stats", () => {
  expect(Stats).toBeDefined();
});

it("repro 1516: can use undefined/null to specify default flag", () => {
  const path = `${tmpdir()}/repro_1516.txt`;
  writeFileSync(path, "b", { flag: undefined });
  // @ts-ignore-next-line
  expect(readFileSync(path, { encoding: "utf8", flag: null })).toBe("b");
  rmSync(path);
});

it("existsSync with invalid path doesn't throw", () => {
  expect(existsSync(null as any)).toBe(false);
  expect(existsSync(123 as any)).toBe(false);
  expect(existsSync(undefined as any)).toBe(false);
  expect(existsSync({ invalid: 1 } as any)).toBe(false);
});

describe("utimesSync", () => {
  it("works", () => {
    const tmp = join(tmpdir(), "utimesSync-test-file-" + Math.random().toString(36).slice(2));
    writeFileSync(tmp, "test");
    const prevStats = fs.statSync(tmp);
    const prevModifiedTime = prevStats.mtime;
    const prevAccessTime = prevStats.atime;

    prevModifiedTime.setMilliseconds(0);
    prevAccessTime.setMilliseconds(0);

    prevModifiedTime.setFullYear(1996);
    prevAccessTime.setFullYear(1996);

    // Get the current time to change the timestamps
    const newModifiedTime = new Date();
    const newAccessTime = new Date();

    newModifiedTime.setMilliseconds(0);
    newAccessTime.setMilliseconds(0);

    fs.utimesSync(tmp, newAccessTime, newModifiedTime);

    const newStats = fs.statSync(tmp);

    expect(newStats.mtime).toEqual(newModifiedTime);
    expect(newStats.atime).toEqual(newAccessTime);

    fs.utimesSync(tmp, prevAccessTime, prevModifiedTime);

    const finalStats = fs.statSync(tmp);

    expect(finalStats.mtime).toEqual(prevModifiedTime);
    expect(finalStats.atime).toEqual(prevAccessTime);
  });

  it("accepts a Number(value).toString()", () => {
    const tmp = join(tmpdir(), "utimesSync-test-file2-" + Math.random().toString(36).slice(2));
    writeFileSync(tmp, "test");
    const prevStats = fs.statSync(tmp);
    const prevModifiedTime = prevStats.mtime;
    const prevAccessTime = prevStats.atime;

    prevModifiedTime.setMilliseconds(0);
    prevAccessTime.setMilliseconds(0);

    prevModifiedTime.setFullYear(1996);
    prevAccessTime.setFullYear(1996);

    // Get the current time to change the timestamps
    const newModifiedTime = new Date();
    const newAccessTime = new Date();

    newModifiedTime.setMilliseconds(0);
    newAccessTime.setMilliseconds(0);

    fs.utimesSync(tmp, newAccessTime.getTime() / 1000 + "", newModifiedTime.getTime() / 1000 + "");

    const newStats = fs.statSync(tmp);

    expect(newStats.mtime).toEqual(newModifiedTime);
    expect(newStats.atime).toEqual(newAccessTime);

    fs.utimesSync(tmp, prevAccessTime.getTime() / 1000 + "", prevModifiedTime.getTime() / 1000 + "");

    const finalStats = fs.statSync(tmp);

    expect(finalStats.mtime).toEqual(prevModifiedTime);
    expect(finalStats.atime).toEqual(prevAccessTime);
  });

  // TODO: make this work on Windows
  it.skipIf(isWindows)("works after 2038", () => {
    const tmp = join(tmpdir(), "utimesSync-test-file-" + Math.random().toString(36).slice(2));
    writeFileSync(tmp, "test");
    const prevStats = fs.statSync(tmp);
    const prevModifiedTime = prevStats.mtime;
    const prevAccessTime = prevStats.atime;

    prevModifiedTime.setMilliseconds(0);
    prevAccessTime.setMilliseconds(0);

    prevModifiedTime.setFullYear(1996);
    prevAccessTime.setFullYear(1996);

    // Get the current time to change the timestamps
    const newModifiedTime = new Date("2045-04-30 19:32:12.333");
    const newAccessTime = new Date("2098-01-01 00:00:00");

    fs.utimesSync(tmp, newAccessTime, newModifiedTime);

    const newStats = fs.statSync(tmp);

    expect(newStats.mtime).toEqual(newModifiedTime);
    expect(newStats.atime).toEqual(newAccessTime);

    fs.utimesSync(tmp, prevAccessTime, prevModifiedTime);

    const finalStats = fs.statSync(tmp);

    expect(finalStats.mtime).toEqual(prevModifiedTime);
    expect(finalStats.atime).toEqual(prevAccessTime);
  });

  // Windows wraps pre-epoch times through u32, matching Node (see Stat.rs)
  it.skipIf(isWindows)("sets pre-epoch times from negative fractional string timestamps", () => {
    const tmp = join(tmpdir(), "utimesSync-test-file-" + Math.random().toString(36).slice(2));
    writeFileSync(tmp, "test");

    fs.utimesSync(tmp, "-1.5", "-1.5");

    const stats = fs.statSync(tmp);
    expect(stats.atime.getTime()).toBe(-1500);
    expect(stats.mtime.getTime()).toBe(-1500);

    // rem_euclid rounds to exactly 1.0 here; must not produce tv_nsec == 1e9 (EINVAL)
    fs.utimesSync(tmp, "-1e-17", "-1e-17");
    expect(fs.statSync(tmp).mtime.getTime()).toBe(0);
  });

  it("treats negative number timestamps as the current time", () => {
    const tmp = join(tmpdir(), "utimesSync-test-file-" + Math.random().toString(36).slice(2));
    writeFileSync(tmp, "test");

    // known-old precondition so the assertion below proves the call did something
    fs.utimesSync(tmp, 0, 0);
    expect(fs.statSync(tmp).mtime.getTime()).toBe(0);

    // fs timestamp granularity can be coarser than Date.now()
    const before = Date.now() - 1000;
    fs.utimesSync(tmp, -1.5, -1.5);

    const stats = fs.statSync(tmp);
    expect(stats.mtime.getTime()).toBeGreaterThanOrEqual(before);
    expect(stats.atime.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("works with whole numbers", () => {
    const atime = Math.floor(Date.now() / 1000);
    const mtime = Math.floor(Date.now() / 1000);

    const tmp = join(tmpdir(), "utimesSync-test-file-" + Math.random().toString(36).slice(2));
    writeFileSync(tmp, "test");

    fs.utimesSync(tmp, atime, mtime);

    const newStats = fs.statSync(tmp);

    expect(newStats.mtime.getTime() / 1000).toEqual(mtime);
    expect(newStats.atime.getTime() / 1000).toEqual(atime);
  });
});

it("createReadStream on a large file emits readable event correctly", () => {
  return new Promise<void>((resolve, reject) => {
    const tmp = mkdtempSync(`${tmpdir()}/readable`);
    // write a 10mb file
    writeFileSync(`${tmp}/large.txt`, "a".repeat(10 * 1024 * 1024));
    var stream = createReadStream(`${tmp}/large.txt`);
    var ended = false;
    var timer: Timer;
    stream.on("readable", () => {
      const v = stream.read();
      if (ended) {
        clearTimeout(timer);
        reject(new Error("readable emitted after end"));
      } else if (v == null) {
        ended = true;
        timer = setTimeout(() => {
          resolve();
        }, 20);
      }
    });
  });
});

describe("fs.write", () => {
  it("should work with (fd, buffer, offset, length, position, callback)", done => {
    const path = `${tmpdir()}/bun-fs-write-1-${Date.now()}.txt`;
    const fd = fs.openSync(path, "w");
    const buffer = Buffer.from("bun");
    fs.write(fd, buffer, 0, buffer.length, 0, err => {
      try {
        expect(err).toBeNull();
        expect(readFileSync(path, "utf8")).toStrictEqual("bun");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });

  it("should work with (fd, buffer, offset, length, callback)", done => {
    const path = `${tmpdir()}/bun-fs-write-2-${Date.now()}.txt`;
    const fd = fs.openSync(path, "w");
    const buffer = Buffer.from("bun");
    fs.write(fd, buffer, 0, buffer.length, (err, written, buffer) => {
      try {
        expect(err).toBeNull();
        expect(written).toBe(3);
        expect(buffer.slice(0, written).toString()).toStrictEqual("bun");
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(readFileSync(path, "utf8")).toStrictEqual("bun");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });

  it("should work with (fd, string, position, encoding, callback)", done => {
    const path = `${tmpdir()}/bun-fs-write-3-${Date.now()}.txt`;
    const fd = fs.openSync(path, "w");
    const string = "bun";
    fs.write(fd, string, 0, "utf8", (err, written, string) => {
      try {
        expect(err).toBeNull();
        expect(written).toBe(3);
        expect(string.slice(0, written).toString()).toStrictEqual("bun");
        expect(string).toBeTypeOf("string");
        expect(readFileSync(path, "utf8")).toStrictEqual("bun");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });

  // Same bug as the writeSync case: the encoding was parsed but never applied.
  it("honors a non-utf8 encoding for strings", async () => {
    const expected = [...Buffer.from("bun", "utf16le")];
    const dest = join(tmpdirSync(), "fs-write-string-encoding.bin");

    // fs.write(fd, string, position, encoding, callback)
    {
      const fd = fs.openSync(dest, "w");
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      fs.write(fd, "bun", null, "utf16le", (err, written) => (err ? reject(err) : resolve(written)));
      try {
        expect(await promise).toBe(6);
      } finally {
        closeSync(fd);
      }
      expect([...readFileSync(dest)]).toEqual(expected);
    }

    // filehandle.write(string, position, encoding)
    {
      const handle = await promises.open(dest, "w");
      try {
        expect((await handle.write("bun", 0, "utf16le")).bytesWritten).toBe(6);
      } finally {
        await handle.close();
      }
      expect([...readFileSync(dest)]).toEqual(expected);
    }
  });

  // Node rejects a non-string, non-view buffer with ERR_INVALID_ARG_TYPE
  // before validating the encoding against it. `{ length: 3 }` with "hex"
  // would otherwise be rejected by validateEncoding with the wrong code.
  it("rejects a non-string, non-view buffer before the encoding is validated", async () => {
    const dest = join(tmpdirSync(), "fs-write-buffer-type.bin");
    const badBuffer = { length: 3 } as unknown as string;
    const fd = fs.openSync(dest, "w");
    try {
      expect(() => fs.write(fd, badBuffer, 0, "hex", () => {})).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
      expect(() => fs.writeSync(fd, badBuffer, 0, "hex")).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    } finally {
      closeSync(fd);
    }
    const handle = await promises.open(dest, "w");
    try {
      const outcome = await handle.write(badBuffer, 0, "hex").then(
        () => "resolved",
        err => err.code,
      );
      expect(outcome).toBe("ERR_INVALID_ARG_TYPE");
    } finally {
      await handle.close();
    }
  });

  it("should work with (fd, string, position, callback)", done => {
    const path = `${tmpdir()}/bun-fs-write-4-${Date.now()}.txt`;
    const fd = fs.openSync(path, "w");
    const string = "bun";
    fs.write(fd, string, 0, (err, written, string) => {
      try {
        expect(err).toBeNull();
        expect(written).toBe(3);
        expect(string.slice(0, written).toString()).toStrictEqual("bun");
        expect(string).toBeTypeOf("string");
        expect(readFileSync(path, "utf8")).toStrictEqual("bun");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });

  it("should work with util.promisify", async () => {
    const path = `${tmpdir()}/bun-fs-write-5-${Date.now()}.txt`;
    const fd = fs.openSync(path, "w");
    const string = "bun";
    const fswrite = promisify(fs.write);
    const ret = await fswrite(fd, string, 0);
    expect(typeof ret === "object").toBeTrue();
    expect(ret.bytesWritten === 3).toBeTrue();
    expect(ret.buffer === string).toBeTrue();
    expect(readFileSync(path, "utf8")).toStrictEqual("bun");
    fs.closeSync(fd);
  });
});

describe("fs.read", () => {
  it("should work with (fd, callback)", done => {
    const path = `${tmpdir()}/bun-fs-read-1-${Date.now()}.txt`;
    fs.writeFileSync(path, "bun");

    const fd = fs.openSync(path, "r");
    fs.read(fd, (err, bytesRead, buffer) => {
      try {
        expect(err).toBeNull();
        expect(bytesRead).toBe(3);
        expect(buffer).toStrictEqual(Buffer.concat([Buffer.from("bun"), Buffer.alloc(16381)]));
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });
  it("should work with (fd, options, callback)", done => {
    const path = `${tmpdir()}/bun-fs-read-2-${Date.now()}.txt`;
    fs.writeFileSync(path, "bun");

    const fd = fs.openSync(path, "r");
    const buffer = Buffer.alloc(16);
    fs.read(fd, { buffer: buffer }, (err, bytesRead, buffer) => {
      try {
        expect(err).toBeNull();
        expect(bytesRead).toBe(3);
        expect(buffer.slice(0, bytesRead).toString()).toStrictEqual("bun");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });
  it("should work with (fd, buffer, offset, length, position, callback)", done => {
    const path = `${tmpdir()}/bun-fs-read-3-${Date.now()}.txt`;
    fs.writeFileSync(path, "bun");

    const fd = fs.openSync(path, "r");
    const buffer = Buffer.alloc(16);
    fs.read(fd, buffer, 0, buffer.length, 0, (err, bytesRead, buffer) => {
      try {
        expect(err).toBeNull();
        expect(bytesRead).toBe(3);
        expect(buffer.slice(0, bytesRead).toString()).toStrictEqual("bun");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });
  it("should work with offset", done => {
    const path = `${tmpdir()}/bun-fs-read-4-${Date.now()}.txt`;
    fs.writeFileSync(path, "bun");

    const fd = fs.openSync(path, "r");
    const buffer = Buffer.alloc(16);
    fs.read(fd, buffer, 1, buffer.length - 1, 0, (err, bytesRead, buffer) => {
      try {
        expect(err).toBeNull();
        expect(bytesRead).toBe(3);
        expect(buffer.slice(1, bytesRead + 1).toString()).toStrictEqual("bun");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });
  it("should work with position", done => {
    const path = `${tmpdir()}/bun-fs-read-5-${Date.now()}.txt`;
    fs.writeFileSync(path, "bun");

    const fd = fs.openSync(path, "r");
    const buffer = Buffer.alloc(16);
    fs.read(fd, buffer, 0, buffer.length, 1, (err, bytesRead, buffer) => {
      try {
        expect(err).toBeNull();
        expect(bytesRead).toBe(2);
        expect(buffer.slice(0, bytesRead).toString()).toStrictEqual("un");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });
  it("should work with both position and offset", done => {
    const path = `${tmpdir()}/bun-fs-read-6-${Date.now()}.txt`;
    fs.writeFileSync(path, "bun");

    const fd = fs.openSync(path, "r");
    const buffer = Buffer.alloc(16);
    fs.read(fd, buffer, 1, buffer.length - 1, 1, (err, bytesRead, buffer) => {
      try {
        expect(err).toBeNull();
        expect(bytesRead).toBe(2);
        expect(buffer.slice(1, bytesRead + 1).toString()).toStrictEqual("un");
      } catch (e) {
        return done(e);
      } finally {
        unlinkSync(path);
        closeSync(fd);
      }
      done();
    });
  });
  it("should work with util.promisify", async () => {
    const path = `${tmpdir()}/bun-fs-read-6-${Date.now()}.txt`;
    fs.writeFileSync(path, "bun bun bun bun");

    const fd = fs.openSync(path, "r");
    const buffer = Buffer.alloc(15);
    const fsread = promisify(fs.read) as any;

    const ret = await fsread(fd, buffer, 0, 15, 0);
    expect(typeof ret === "object").toBeTrue();
    expect(ret.bytesRead === 15).toBeTrue();
    expect(buffer.slice().toString() === "bun bun bun bun").toBeTrue();
    fs.closeSync(fd);
  });
});

it("new Stats", () => {
  // @ts-expect-error
  const stats = new Stats(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14);
  expect(stats).toBeDefined();
  // dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs
  expect(stats.dev).toBe(1);
  expect(stats.mode).toBe(2);
  expect(stats.nlink).toBe(3);
  expect(stats.uid).toBe(4);
  expect(stats.gid).toBe(5);
  expect(stats.rdev).toBe(6);
  expect(stats.blksize).toBe(7);
  expect(stats.ino).toBe(8);
  expect(stats.size).toBe(9);
  expect(stats.blocks).toBe(10);
  expect(stats.atimeMs).toBe(11);
  expect(stats.mtimeMs).toBe(12);
  expect(stats.ctimeMs).toBe(13);
  expect(stats.birthtimeMs).toBe(14);
  expect(stats.atime).toEqual(new Date(11));
  expect(stats.mtime).toEqual(new Date(12));
  expect(stats.ctime).toEqual(new Date(13));
  expect(stats.birthtime).toEqual(new Date(14));
});

/// TODO: why is `.ino` wrong on x86_64 MacOS?
(isIntelMacOS ? it.todo : it)("BigIntStats", () => {
  const withoutBigInt = statSync(import.meta.path, { bigint: false });
  const withBigInt = statSync(import.meta.path, { bigint: true });

  expect(withoutBigInt.isFile() === withBigInt.isFile()).toBe(true);
  expect(withoutBigInt.isDirectory() === withBigInt.isDirectory()).toBe(true);
  expect(withoutBigInt.isBlockDevice() === withBigInt.isBlockDevice()).toBe(true);
  expect(withoutBigInt.isCharacterDevice() === withBigInt.isCharacterDevice()).toBe(true);
  expect(withoutBigInt.isSymbolicLink() === withBigInt.isSymbolicLink()).toBe(true);
  expect(withoutBigInt.isFIFO() === withBigInt.isFIFO()).toBe(true);
  expect(withoutBigInt.isSocket() === withBigInt.isSocket()).toBe(true);

  const expectclose = (a: bigint, b: bigint) => expect(Math.abs(Number(a - b))).toBeLessThan(1000);

  expectclose(BigInt(withoutBigInt.dev), withBigInt.dev);
  expectclose(BigInt(withoutBigInt.ino), withBigInt.ino);
  expectclose(BigInt(withoutBigInt.mode), withBigInt.mode);
  expectclose(BigInt(withoutBigInt.nlink), withBigInt.nlink);
  expectclose(BigInt(withoutBigInt.uid), withBigInt.uid);
  expectclose(BigInt(withoutBigInt.gid), withBigInt.gid);
  expectclose(BigInt(withoutBigInt.rdev), withBigInt.rdev);
  expectclose(BigInt(withoutBigInt.size), withBigInt.size);
  expectclose(BigInt(withoutBigInt.blksize), withBigInt.blksize);
  expectclose(BigInt(withoutBigInt.blocks), withBigInt.blocks);
  expectclose(BigInt(Math.floor(withoutBigInt.atimeMs)), withBigInt.atimeMs);
  expectclose(BigInt(Math.floor(withoutBigInt.mtimeMs)), withBigInt.mtimeMs);
  expectclose(BigInt(Math.floor(withoutBigInt.ctimeMs)), withBigInt.ctimeMs);
  expectclose(BigInt(Math.floor(withoutBigInt.birthtimeMs)), withBigInt.birthtimeMs);

  // Allow ±1ms leeway: the non-bigint path goes through a float and can round differently.
  expect(Math.abs(withBigInt.atime.getTime() - withoutBigInt.atime.getTime())).toBeLessThanOrEqual(1);
  expect(Math.abs(withBigInt.mtime.getTime() - withoutBigInt.mtime.getTime())).toBeLessThanOrEqual(1);
  expect(Math.abs(withBigInt.ctime.getTime() - withoutBigInt.ctime.getTime())).toBeLessThanOrEqual(1);
  expect(Math.abs(withBigInt.birthtime.getTime() - withoutBigInt.birthtime.getTime())).toBeLessThanOrEqual(1);
});

it("test syscall errno, issue#4198", () => {
  const path = `${tmpdir()}/non-existent-${Date.now()}.txt`;
  expect(() => openSync(path, "r")).toThrow("no such file or directory");
  expect(() => readSync(2147483640, Buffer.alloc(1))).toThrow("bad file descriptor");
  expect(() => readlinkSync(path)).toThrow("no such file or directory");
  expect(() => realpathSync(path)).toThrow("no such file or directory");
  expect(() => readFileSync(path)).toThrow("no such file or directory");
  expect(() => renameSync(path, `${path}.2`)).toThrow("no such file or directory");
  expect(() => statSync(path)).toThrow("no such file or directory");
  expect(() => unlinkSync(path)).toThrow("no such file or directory");
  expect(() => rmSync(path)).toThrow("no such file or directory");
  expect(() => rmdirSync(path)).toThrow("no such file or directory");
  expect(() => closeSync(2147483640)).toThrow("bad file descriptor");

  mkdirSync(path);
  expect(() => mkdirSync(path)).toThrow("file already exists");
  expect(() => unlinkSync(path)).toThrow(
    (
      {
        "darwin": "operation not permitted",
        "linux": "illegal operation on a directory",
        "win32": "operation not permitted",
      } as any
    )[process.platform],
  );
  rmdirSync(path);
});

describe("error.syscall is node's operation name, not the raw kernel syscall", () => {
  // Node documents err.syscall as a stable, platform-independent operation
  // name ("stat", "lstat", "utime", ...). On Linux, Bun implements stat via
  // statx(2) and utimes via utimensat(2); the implementation detail must not
  // leak into err.syscall.
  const missing = join(tmpdir(), "fs-syscall-" + Date.now(), "nope");
  const badfd = 2147483640;
  const syscallOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e: any) {
      return e.syscall;
    }
    throw new Error("expected to throw");
  };
  const syscallOfAsync = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      return e.syscall;
    }
    throw new Error("expected to reject");
  };

  it("sync", () => {
    expect({
      stat: syscallOf(() => statSync(missing)),
      lstat: syscallOf(() => lstatSync(missing)),
      fstat: syscallOf(() => fstatSync(badfd)),
      utimes: syscallOf(() => fs.utimesSync(missing, 1, 1)),
      lutimes: syscallOf(() => fs.lutimesSync(missing, 1, 1)),
      futimes: syscallOf(() => fs.futimesSync(badfd, 1, 1)),
    }).toEqual({
      stat: "stat",
      lstat: "lstat",
      fstat: "fstat",
      utimes: "utime",
      lutimes: "lutime",
      futimes: "futime",
    });
  });

  it("syscall appears in the error message", () => {
    expect(() => statSync(missing)).toThrow(/, stat '/);
    expect(() => lstatSync(missing)).toThrow(/, lstat '/);
    expect(() => fs.utimesSync(missing, 1, 1)).toThrow(/, utime '/);
    expect(() => fs.lutimesSync(missing, 1, 1)).toThrow(/, lutime '/);
  });

  it("async (fs/promises)", async () => {
    expect({
      stat: await syscallOfAsync(() => promises.stat(missing)),
      lstat: await syscallOfAsync(() => promises.lstat(missing)),
      utimes: await syscallOfAsync(() => promises.utimes(missing, 1, 1)),
      lutimes: await syscallOfAsync(() => promises.lutimes(missing, 1, 1)),
    }).toEqual({
      stat: "stat",
      lstat: "lstat",
      utimes: "utime",
      lutimes: "lutime",
    });
  });

  it("async (callback)", async () => {
    const cb = (fn: (cb: (err: any) => void) => void) =>
      new Promise<string>(resolve => fn(err => resolve(err?.syscall)));
    expect({
      stat: await cb(done => fs.stat(missing, done)),
      lstat: await cb(done => fs.lstat(missing, done)),
      utimes: await cb(done => fs.utimes(missing, 1, 1, done)),
      lutimes: await cb(done => fs.lutimes(missing, 1, 1, done)),
    }).toEqual({
      stat: "stat",
      lstat: "lstat",
      utimes: "utime",
      lutimes: "lutime",
    });
  });

  it("FileHandle.read after close reports 'read', not 'fsync'", async () => {
    using dir = tempDir("fs-syscall-fh", { "f.txt": "hello" });
    const handle = await promises.open(join(String(dir), "f.txt"), "r");
    await handle.close();
    let err: any;
    try {
      await handle.read(Buffer.alloc(1), 0, 1, 0);
    } catch (e) {
      err = e;
    }
    expect({ code: err?.code, syscall: err?.syscall }).toEqual({ code: "EBADF", syscall: "read" });
  });
});

it.if(isWindows)("writing to windows hidden file is possible", () => {
  const temp = tmpdir();
  writeFileSync(join(temp, "file.txt"), "FAIL");
  const status = Bun.spawnSync(["cmd", "/C", "attrib +h file.txt"], {
    stdio: ["ignore", "ignore", "ignore"],
    cwd: temp,
  });
  expect(status.exitCode).toBe(0);
  writeFileSync(join(temp, "file.txt"), "Hello World");
  const content = readFileSync(join(temp, "file.txt"), "utf8");
  expect(content).toBe("Hello World");
});

it("fs.ReadStream allows functions", () => {
  // @ts-expect-error
  expect(() => new fs.ReadStream(".", function lol() {})).not.toThrow();
  // @ts-expect-error
  expect(() => new fs.ReadStream(".", {})).not.toThrow();
});

describe.if(isWindows)("windows path handling", () => {
  // dont call `it` because these paths wont make sense
  // the `it` in this branch makes something be printed on posix'
  if (!isWindows) return it("works", () => {});

  const file = import.meta.path.slice(3);
  const drive = import.meta.path[0];
  const filenames = [
    `${drive}:\\${file}`,
    `\\\\127.0.0.1\\${drive}$\\${file}`,
    `\\\\LOCALHOST\\${drive}$\\${file}`,
    `\\\\.\\${drive}:\\${file}`,
    `\\\\?\\${drive}:\\${file}`,
    `\\\\.\\UNC\\LOCALHOST\\${drive}$\\${file}`,
    `\\\\?\\UNC\\LOCALHOST\\${drive}$\\${file}`,
    `\\\\127.0.0.1\\${drive}$\\${file}`,
  ];

  for (const filename of filenames) {
    it(`Can read '${filename}' with node:fs`, async () => {
      const stats = await fs.promises.stat(filename);
      expect(stats.size).toBeGreaterThan(0);
    });

    it(`Can read '${filename}' with Bun.file`, async () => {
      const stats = await Bun.file(filename).text();
      expect(stats.length).toBeGreaterThan(0);
    });
  }
});

it("using writeFile on an fd does not truncate it", () => {
  const filepath = join(tmpdir(), `file-${Math.random().toString(32).slice(2)}.txt`);
  const fd = fs.openSync(filepath, "w+");
  fs.writeFileSync(fd, "x");
  fs.writeFileSync(fd, "x");
  fs.closeSync(fd);
  const content = fs.readFileSync(filepath, "utf8");
  expect(content).toBe("xx");
});

it("fs.close with one arg works", () => {
  const filepath = join(tmpdir(), `file-${Math.random().toString(32).slice(2)}.txt`);
  const fd = fs.openSync(filepath, "w+");
  fs.close(fd);
});

it("existsSync should never throw ENAMETOOLONG", () => {
  expect(existsSync(new Array(16).fill(new Array(64).fill("a")).join("/"))).toBeFalse();
});

it("promises exists should never throw ENAMETOOLONG", async () => {
  expect(await _promises.exists(new Array(16).fill(new Array(64).fill("a")).join("/"))).toBeFalse();
});

it("promises.fdatasync with a bad fd should include that in the error thrown", async () => {
  try {
    await _promises.fdatasync(50000);
  } catch (e) {
    expect(typeof e.fd).toBe("number");
    expect(e.fd).toBe(50000);
    return;
  }
  expect.unreachable();
});

it("promises.cp should work even if dest does not exist", async () => {
  const x_dir = tmpdirSync();
  const text_expected = "A".repeat(131073);
  let src = "package-lock.json";
  let folder = "folder-not-exist";
  let dst = join(folder, src);

  src = join(x_dir, src);
  folder = join(x_dir, folder);
  dst = join(x_dir, dst);

  await promises.writeFile(src, text_expected);
  await promises.rm(folder, { recursive: true, force: true });
  await promises.cp(src, dst);

  const text_actual = await Bun.file(dst).text();
  expect(text_actual).toBe(text_expected);
});

it("promises.writeFile should accept a FileHandle", async () => {
  const x_dir = tmpdirSync();
  const x_path = join(x_dir, "dummy.txt");
  await using file = await fs.promises.open(x_path, "w");
  await fs.promises.writeFile(file, "data");
  expect(await Bun.file(x_path).text()).toBe("data");
});

it("promises.readFile should accept a FileHandle", async () => {
  const x_dir = tmpdirSync();
  const x_path = join(x_dir, "dummy.txt");
  await Bun.write(Bun.file(x_path), "data");
  await using file = await fs.promises.open(x_path, "r");
  expect((await fs.promises.readFile(file)).toString()).toBe("data");
});

it("promises.appendFile should accept a FileHandle", async () => {
  const x_dir = tmpdirSync();
  const x_path = join(x_dir, "dummy.txt");
  await using file = await fs.promises.open(x_path, "w");
  await fs.promises.appendFile(file, "data");
  expect(await Bun.file(x_path).text()).toBe("data");
  await fs.promises.appendFile(file, "data");
  expect(await Bun.file(x_path).text()).toBe("datadata");
});

it("chown should verify its arguments", () => {
  expect(() => fs.chown("doesnt-matter.txt", "a", 0)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
  expect(() => fs.chown("doesnt-matter.txt", 0, "a")).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
});

// https://github.com/oven-sh/bun/issues/32050
it("lchown succeeds on every platform", async () => {
  const dir = tmpdirSync();
  const file = join(dir, "lchown.txt");
  writeFileSync(file, "x");
  // A dangling symlink distinguishes lchown from chown: it operates on the
  // link itself, so the missing target must not matter.
  const link = join(dir, "lchown-link");
  symlinkSync(join(dir, "does-not-exist"), link);

  for (const target of [file, link]) {
    // uid/gid of -1 means "leave unchanged", so this succeeds unprivileged.
    expect(fs.lchownSync(target, -1, -1)).toBeUndefined();
    await expect(fs.promises.lchown(target, -1, -1)).resolves.toBeUndefined();
    await new Promise<void>((resolve, reject) => {
      fs.lchown(target, -1, -1, err => (err ? reject(err) : resolve()));
    });
  }
});

it("open flags verification", async () => {
  const invalid = 4_294_967_296;
  expect(() => fs.open(__filename, invalid, () => {})).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
  expect(() => fs.openSync(__filename, invalid)).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
  expect(async () => await fs.promises.open(__filename, invalid)).toThrow(RangeError);

  expect(() => fs.open(__filename, 4294967298.5, () => {})).toThrow(
    RangeError(`The value of "flags" is out of range. It must be an integer. Received 4294967298.5`),
  );
});

// Node's stringToFlags throws ERR_INVALID_ARG_VALUE for every unrecognized
// flag string; Bun threw ERR_INVALID_ARG_TYPE.
it("an unrecognized flag string throws ERR_INVALID_ARG_VALUE", () => {
  for (const flag of ["bogus", "", "z", Buffer.alloc(32, "w").toString()]) {
    expect(() => fs.openSync(__filename, flag)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
    expect(() => fs.open(__filename, flag, () => {})).toThrowWithCode(TypeError, "ERR_INVALID_ARG_VALUE");
  }
});

it("open mode verification", async () => {
  const invalid = 4_294_967_296;
  expect(() => fs.open(__filename, 0, invalid, () => {})).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
  expect(() => fs.openSync(__filename, 0, invalid)).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
  expect(async () => await fs.promises.open(__filename, 0, invalid)).toThrow(RangeError);

  expect(() => fs.open(__filename, 0, 4294967298.5, () => {})).toThrow(
    RangeError(`The value of "mode" is out of range. It must be an integer. Received 4294967298.5`),
  );
});

it("fs.mkdirSync recursive should not error when the directory already exists, but should error when its a file", () => {
  expect(() => mkdirSync(import.meta.dir, { recursive: true })).not.toThrowError();
  expect(() => mkdirSync(import.meta.path, { recursive: true })).toThrowError();
});

it("fs.mkdirSync recursive: false should error when the directory already exists, regardless if its a file or dir", () => {
  expect(() => mkdirSync(import.meta.dir, { recursive: false })).toThrowError();
  expect(() => mkdirSync(import.meta.path, { recursive: false })).toThrowError();
});

it("fs.statfsSync should work", () => {
  const stats = statfsSync(import.meta.path);
  ["type", "bsize", "blocks", "bfree", "bavail", "files", "ffree"].forEach(k => {
    expect(stats).toHaveProperty(k);
    expect(stats[k]).toBeNumber();
  });

  // Regression for oven-sh/bun#31133: on darwin-x64, libc::statfs linked
  // to `statfs$INODE64` was writing a legacy struct layout, so bsize came
  // back as 0 and the remaining fields were shifted. Any real filesystem
  // has a positive block size and at least one block — asserting that here
  // catches the misaligned-struct case without depending on absolute values.
  if (isPosix) {
    expect(stats.bsize).toBeGreaterThan(0);
    expect(stats.blocks).toBeGreaterThan(0);
  }

  const bigIntStats = statfsSync(import.meta.path, { bigint: true });
  ["type", "bsize", "blocks", "bfree", "bavail", "files", "ffree"].forEach(k => {
    expect(bigIntStats).toHaveProperty(k);
    expect(bigIntStats[k]).toBeTypeOf("bigint");
  });
  if (isPosix) {
    expect(bigIntStats.bsize > 0n).toBe(true);
    expect(bigIntStats.blocks > 0n).toBe(true);
  }
});

it("fs.promises.statfs should work", async () => {
  const stats = await fs.promises.statfs(import.meta.path);
  expect(stats).toBeDefined();
  // See "fs.statfsSync should work" above — same regression gate for #31133.
  if (isPosix) {
    expect(stats.bsize).toBeGreaterThan(0);
    expect(stats.blocks).toBeGreaterThan(0);
  }
});

it("fs.promises.statfs should work with bigint", async () => {
  const stats = await fs.promises.statfs(import.meta.path, { bigint: true });
  expect(stats).toBeDefined();
  if (isPosix) {
    expect(stats.bsize > 0n).toBe(true);
    expect(stats.blocks > 0n).toBe(true);
  }
});

it("fs.statfs (callback) should work with bigint", async () => {
  const { promise, resolve } = Promise.withResolvers();
  fs.statfs(import.meta.path, { bigint: true }, (err, stats) => {
    if (err) return resolve(err);
    resolve(stats);
  });
  const stats = await promise;
  expect(stats).toBeDefined();
  for (const k of ["type", "bsize", "blocks", "bfree", "bavail", "files", "ffree"]) {
    expect(stats).toHaveProperty(k);
    expect(stats[k]).toBeTypeOf("bigint");
  }
  // See "fs.statfsSync should work" above — same regression gate for #31133.
  if (isPosix) {
    expect(stats.bsize > 0n).toBe(true);
    expect(stats.blocks > 0n).toBe(true);
  }
});

it("fs.Stat constructor", () => {
  expect(new Stats()).toMatchObject({
    "atimeMs": undefined,
    "birthtimeMs": undefined,
    "blksize": undefined,
    "blocks": undefined,
    "ctimeMs": undefined,
    "dev": undefined,
    "gid": undefined,
    "ino": undefined,
    "mode": undefined,
    "mtimeMs": undefined,
    "nlink": undefined,
    "rdev": undefined,
    "size": undefined,
    "uid": undefined,
  });
});

it("fs.Stat constructor with options", () => {
  // @ts-ignore
  expect(new Stats(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)).toMatchObject({
    atimeMs: 10,
    birthtimeMs: 13,
    blksize: 6,
    blocks: 9,
    ctimeMs: 12,
    dev: 0,
    gid: 4,
    ino: 7,
    mode: 1,
    mtimeMs: 11,
    nlink: 2,
    rdev: 5,
    size: 8,
    uid: 3,
  });
});

it("fs.Stat.atime reflects date matching Node.js behavior", () => {
  {
    const date = new Date();
    const stats = new Stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    stats.atime = date;
    expect(stats.atime).toBe(date);
  }

  {
    const stats = new Stats();
    expect(stats.atime.getTime()).toEqual(new Date(undefined).getTime());
  }

  {
    const stats = new Stats();
    const now = Date.now();
    stats.atimeMs = now;
    expect(stats.atime).toEqual(new Date(now));
  }

  {
    const stats = new Stats();
    stats.atimeMs = 0;
    expect(stats.atime).toEqual(new Date(0));
    const now = Date.now();
    stats.atimeMs = now;
    expect(stats.atime).toEqual(new Date(0));
  }
});

describe('kernel32 long path conversion does not mangle "../../path" into "path"', () => {
  const tmp1 = tempDirWithFiles("longpath", {
    "a/b/config": "true",
  });
  const tmp2 = tempDirWithFiles("longpath", {
    "a/b/hello": "true",
    "config": "true",
  });
  const workingDir1 = path.join(tmp1, "a/b");
  const workingDir2 = path.join(tmp2, "a/b");
  const nonExistTests = [
    ["existsSync", 'assert.strictEqual(fs.existsSync("../../config"), false)'],
    ["accessSync", 'assert.throws(() => fs.accessSync("../../config"), { code: "ENOENT" })'],
  ];
  const existTests = [
    ["existsSync", 'assert.strictEqual(fs.existsSync("../../config"), true)'],
    ["accessSync", 'assert.strictEqual(fs.accessSync("../../config"), null)'],
  ];

  for (const [name, code] of nonExistTests) {
    it.concurrent(`${name} (not existing)`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", code],
        cwd: workingDir1,
        stdio: ["ignore", "inherit", "inherit"],
        env: bunEnv,
      });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });
  }
  for (const [name, code] of existTests) {
    it.concurrent(`${name} (existing)`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", code],
        cwd: workingDir2,
        stdio: ["ignore", "inherit", "inherit"],
        env: bunEnv,
      });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });
  }
});

it("overflowing mode doesn't crash", () => {
  // this is easiest to test on windows since mode_t is a u16 there
  expect(() => openSync("./a.txt", 65 * 1024)).toThrow(
    expect.objectContaining({
      name: "Error",
      message: `ENOENT: no such file or directory, open './a.txt'`,
      code: "ENOENT",
      syscall: "open",
      // errno: -4058,
      path: "./a.txt",
    }),
  );
});

describe("numeric flags produce same result as string flags", () => {
  it("numeric O_CREAT|O_TRUNC|O_WRONLY is equivalent to 'w'", () => {
    const { O_CREAT, O_TRUNC, O_WRONLY } = constants;
    const numericFlag = O_CREAT | O_TRUNC | O_WRONLY;

    using dir = tempDir("numeric-flags", {});
    const fileStr = join(String(dir), "string.txt");
    const fileNum = join(String(dir), "numeric.txt");

    const fd1 = openSync(fileStr, "w", 0o666);
    writeSync(fd1, "hello");
    closeSync(fd1);

    const fd2 = openSync(fileNum, numericFlag, 0o666);
    writeSync(fd2, "hello");
    closeSync(fd2);

    expect(readFileSync(fileNum, "utf8")).toBe(readFileSync(fileStr, "utf8"));
  });

  it("numeric O_CREAT|O_WRONLY|O_APPEND is equivalent to 'a'", () => {
    const { O_APPEND, O_CREAT, O_WRONLY } = constants;
    const numericFlag = O_CREAT | O_WRONLY | O_APPEND;

    using dir = tempDir("numeric-flags", {});
    const fileStr = join(String(dir), "string.txt");
    const fileNum = join(String(dir), "numeric.txt");

    const fd1 = openSync(fileStr, "a", 0o666);
    writeSync(fd1, "first");
    closeSync(fd1);
    const fd1b = openSync(fileStr, "a", 0o666);
    writeSync(fd1b, "second");
    closeSync(fd1b);

    const fd2 = openSync(fileNum, numericFlag, 0o666);
    writeSync(fd2, "first");
    closeSync(fd2);
    const fd2b = openSync(fileNum, numericFlag, 0o666);
    writeSync(fd2b, "second");
    closeSync(fd2b);

    expect(readFileSync(fileNum, "utf8")).toBe(readFileSync(fileStr, "utf8"));
    expect(readFileSync(fileNum, "utf8")).toBe("firstsecond");
  });

  it("numeric O_CREAT|O_RDWR|O_TRUNC is equivalent to 'w+'", () => {
    const { O_CREAT, O_RDWR, O_TRUNC } = constants;
    const numericFlag = O_CREAT | O_RDWR | O_TRUNC;

    using dir = tempDir("numeric-flags", {});
    const file = join(String(dir), "readwrite.txt");

    const fd = openSync(file, numericFlag, 0o666);
    writeSync(fd, "read-write");

    // Read back from the same fd to verify O_RDWR actually grants read access.
    const buf = Buffer.alloc(10);
    const bytesRead = readSync(fd, buf, 0, 10, 0);
    closeSync(fd);

    expect(buf.toString("utf8", 0, bytesRead)).toBe("read-write");
  });

  it("numeric O_RDONLY reads existing file", () => {
    const { O_RDONLY } = constants;
    using dir = tempDir("numeric-flags", {});
    const file = join(String(dir), "readonly.txt");

    writeFileSync(file, "existing content");

    const fd = openSync(file, O_RDONLY);
    const buf = Buffer.alloc(50);
    const bytesRead = readSync(fd, buf);
    closeSync(fd);

    expect(buf.slice(0, bytesRead).toString("utf8")).toBe("existing content");
  });

  it("numeric O_CREAT|O_EXCL|O_RDWR fails on existing file", () => {
    const { O_CREAT, O_EXCL, O_RDWR } = constants;
    const numericFlag = O_CREAT | O_EXCL | O_RDWR;

    using dir = tempDir("numeric-flags", {});
    const file = join(String(dir), "excl.txt");

    // First open should succeed (creates the file).
    const fd = openSync(file, numericFlag, 0o666);
    closeSync(fd);

    // Second open with O_EXCL should fail (file already exists).
    expect(() => openSync(file, numericFlag, 0o666)).toThrow();
  });
});

describe("synchronous I/O string flags", () => {
  it("'rs' opens existing file for reading", () => {
    using dir = tempDir("sync-flags", {
      "existing.txt": "sync content",
    });

    const fd = openSync(join(String(dir), "existing.txt"), "rs");
    const buf = Buffer.alloc(20);
    const bytesRead = readSync(fd, buf);
    closeSync(fd);

    expect(buf.slice(0, bytesRead).toString("utf8")).toBe("sync content");
  });

  it("'rs+' opens existing file for read-write", () => {
    using dir = tempDir("sync-flags", {
      "existing.txt": "original",
    });
    const file = join(String(dir), "existing.txt");

    const fd = openSync(file, "rs+");
    writeSync(fd, "replaced");
    closeSync(fd);

    expect(readFileSync(file, "utf8")).toBe("replaced");
  });

  it("'as' creates and appends to file", () => {
    using dir = tempDir("sync-flags", {});
    const file = join(String(dir), "appended.txt");

    const fd = openSync(file, "as");
    writeSync(fd, "sync-append");
    closeSync(fd);

    expect(readFileSync(file, "utf8")).toBe("sync-append");
  });

  it("'as+' creates and appends with read access", () => {
    using dir = tempDir("sync-flags", {});
    const file = join(String(dir), "appended-rw.txt");

    const fd = openSync(file, "as+");
    writeSync(fd, "hello");

    const buf = Buffer.alloc(10);
    const bytesRead = readSync(fd, buf, 0, 10, 0);
    closeSync(fd);

    expect(buf.toString("utf8", 0, bytesRead)).toBe("hello");
  });
});

describe.skipIf(isWindows)("readFileSync on a FIFO larger than the stat size", () => {
  it("does not balloon the read buffer", async () => {
    using dir = tempDir("fs-readfile-fifo", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fs-readfile-fifo-fixture.js"), String(dir)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Pre-fix this never returns (RawVec doubling balloons RSS to multiple GB);
    // the per-test timeout would fire. Fixed: completes promptly with the full
    // 400 KB of content intact.
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("len=409600 allA=true");
    expect(exitCode).toBe(0);
  });
});

it("fs.read keeps filling the caller's view when its ArrayBuffer is transferred while the read is pending", async () => {
  using dir = tempDir("fs-read-transfer", {
    "data.bin": Buffer.alloc(65536, 0x61).toString(),
  });

  // The async read snapshots the destination buffer before handing it to the
  // work pool. Transferring the backing ArrayBuffer immediately afterwards
  // must not leave the in-flight read writing into storage the caller's view
  // no longer owns: the view must still be attached and contain the file's
  // bytes once the read completes.
  const script = `
    const fs = require("node:fs");
    const path = require("node:path");
    (async () => {
      const fd = fs.openSync(path.join(process.cwd(), "data.bin"), "r");
      const ab = new ArrayBuffer(65536);
      const view = new Uint8Array(ab);
      const pending = new Promise((resolve, reject) => {
        fs.read(fd, view, 0, 65536, 0, (err, bytesRead) => (err ? reject(err) : resolve(bytesRead)));
      });
      // Attempt to detach the destination's backing store before the async
      // read completes. Refusing the detach by throwing is also acceptable.
      let transferred;
      try {
        transferred = ab.transfer();
      } catch {}
      const bytesRead = await pending;
      fs.closeSync(fd);
      console.log(
        JSON.stringify({
          bytesRead,
          viewByteLength: view.byteLength,
          first: view[0] ?? null,
          last: view[65535] ?? null,
        }),
      );
    })().catch(err => {
      console.error(err);
      process.exit(1);
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    bytesRead: 65536,
    viewByteLength: 65536,
    first: 0x61,
    last: 0x61,
  });
  expect(exitCode).toBe(0);
});

it("writevSync does not write bytes from a buffer detached by an index getter during argument conversion", () => {
  using dir = tempDir("fs-writev-detach", {});
  const file = join(String(dir), "out.bin");

  // Legitimate case: a plain array of views writes every byte.
  let fd = openSync(file, "w");
  expect(writevSync(fd, [Buffer.from("AAAA"), Buffer.from("BBBB")])).toBe(8);
  closeSync(fd);
  expect(readFileSync(file, "latin1")).toBe("AAAABBBB");

  // An accessor on index 1 detaches element 0's ArrayBuffer while the
  // argument array is still being converted. Every element is read before any
  // data pointer is captured, so the detached element contributes zero bytes
  // instead of a dangling pointer.
  const first = new Uint8Array(new ArrayBuffer(16)).fill(0x41);
  const second = new Uint8Array(8).fill(0x42);
  const buffers: Uint8Array[] = [first];
  Object.defineProperty(buffers, 1, {
    enumerable: true,
    configurable: true,
    get() {
      first.buffer.transfer();
      return second;
    },
  });
  expect(buffers.length).toBe(2);

  fd = openSync(file, "w");
  try {
    expect(writevSync(fd, buffers)).toBe(8);
  } finally {
    closeSync(fd);
  }
  expect(first.buffer.detached).toBe(true);
  expect(readFileSync(file, "latin1")).toBe("BBBBBBBB");
});

it("fs.writev keeps buffers attached while the write is in flight", async () => {
  using dir = tempDir("fs-writev-pin", {});
  const file = join(String(dir), "out.bin");
  const fd = openSync(file, "w");
  const buf = new Uint8Array(new ArrayBuffer(8)).fill(0x43);
  const { promise, resolve, reject } = Promise.withResolvers();
  try {
    fs.writev(fd, [buf], 0, (err, written) => (err ? reject(err) : resolve(written)));

    // The native write runs on the thread pool; the backing store cannot be
    // detached out from under it.
    buf.buffer.transfer();
    expect(buf.buffer.detached).toBe(false);

    expect(await promise).toBe(8);

    // Released once the write completes.
    buf.buffer.transfer();
    expect(buf.buffer.detached).toBe(true);

    // A rejected call must not leave the buffers held either.
    const other = new Uint8Array(new ArrayBuffer(8));
    expect(() => fs.writev(fd, [other], "not a position" as any, () => {})).toThrow();
    other.buffer.transfer();
    expect(other.buffer.detached).toBe(true);
  } finally {
    closeSync(fd);
  }
  expect(readFileSync(file, "latin1")).toBe("CCCCCCCC");
});

it("fs.write keeps the source buffer attached while the write is in flight", async () => {
  using dir = tempDir("fs-write-pin", {});
  const file = join(String(dir), "out.bin");
  const fd = openSync(file, "w");
  const buf = new Uint8Array(new ArrayBuffer(8)).fill(0x44);
  const { promise, resolve, reject } = Promise.withResolvers();
  try {
    fs.write(fd, buf, 0, buf.byteLength, 0, (err, written) => (err ? reject(err) : resolve(written)));

    // The native write runs on the thread pool and reads the source bytes
    // through a raw pointer; the backing store must not be detachable out
    // from under it while the write is pending.
    buf.buffer.transfer();
    expect(buf.buffer.detached).toBe(false);

    expect(await promise).toBe(8);

    // Released once the write completes.
    buf.buffer.transfer();
    expect(buf.buffer.detached).toBe(true);
  } finally {
    closeSync(fd);
  }
  expect(readFileSync(file, "latin1")).toBe("DDDDDDDD");
});

it("fs.promises.writeFile keeps the source buffer attached while the write is in flight", async () => {
  using dir = tempDir("fs-writefile-pin", {});
  const file = join(String(dir), "out.bin");
  const buf = new Uint8Array(new ArrayBuffer(8)).fill(0x45);
  const pending = fs.promises.writeFile(file, buf);

  // The native write runs on the thread pool and reads the source bytes
  // through a raw pointer; the backing store must not be detachable out
  // from under it while the write is pending.
  buf.buffer.transfer();
  expect(buf.buffer.detached).toBe(false);

  await pending;

  // Released once the write completes.
  buf.buffer.transfer();
  expect(buf.buffer.detached).toBe(true);

  expect(readFileSync(file, "latin1")).toBe("EEEEEEEE");
});

it.if(isPosix)("realpathSync reports ENAMETOOLONG when cwd plus the path exceeds the system path limit", async () => {
  using dir = tempDir("fs-realpath-too-long", {});

  // The relative path argument is within the per-argument limit, but joining
  // it onto the (non-root) cwd overflows the internal fixed-size path buffer.
  // Both realpath variants must surface this as a clean ENAMETOOLONG error
  // instead of aborting the process.
  const script = `
    const fs = require("node:fs");
    const longPath = "a".repeat(4090);
    for (const impl of [fs.realpathSync, fs.realpathSync.native]) {
      try {
        impl(longPath);
        console.log("resolved");
      } catch (err) {
        console.log(err.code);
      }
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["ENAMETOOLONG", "ENAMETOOLONG"]);
  expect(exitCode).toBe(0);
});

it("fs.writeFile (callback) keeps the source buffer attached while the write is in flight", async () => {
  using dir = tempDir("fs-writefile-cb-pin", {});
  const file = join(String(dir), "out.bin");
  const buf = new Uint8Array(new ArrayBuffer(8)).fill(0x46);
  const { promise, resolve, reject } = Promise.withResolvers();
  fs.writeFile(file, buf, err => (err ? reject(err) : resolve(null)));

  // The native write runs on the thread pool and reads the source bytes
  // through a raw pointer; the backing store must not be detachable out
  // from under it while the write is pending.
  buf.buffer.transfer();
  expect(buf.buffer.detached).toBe(false);

  await promise;

  // Released once the write completes.
  buf.buffer.transfer();
  expect(buf.buffer.detached).toBe(true);

  expect(readFileSync(file, "latin1")).toBe("FFFFFFFF");
});

it("fs.promises.writeFile keeps a buffer path argument attached while options are read", async () => {
  using dir = tempDir("fs-writefile-path-pin", {});
  const file = join(String(dir), "out.txt");
  const pathBytes = new TextEncoder().encode(file);
  // Standalone ArrayBuffer (not the shared Buffer pool) so detaching it would
  // only affect this path argument.
  const pathBuf = new Uint8Array(new ArrayBuffer(pathBytes.byteLength));
  pathBuf.set(pathBytes);

  let detachedDuringOptions: boolean | undefined;
  await fs.promises.writeFile(pathBuf as any, "hello world", {
    // Reading the options object re-enters JavaScript after the native call
    // captured a pointer into the path buffer; the backing store must not be
    // detachable out from under it.
    get flag() {
      pathBuf.buffer.transfer();
      detachedDuringOptions = pathBuf.buffer.detached;
      return "w";
    },
  });

  expect(detachedDuringOptions).toBe(false);
  expect(readFileSync(file, "utf8")).toBe("hello world");
});

describe("fs.close on stdio descriptors", () => {
  it.skipIf(isWindows)("closeSync(2) actually closes fd 2 and allows redirect", async () => {
    using dir = tempDir("fs-close-stdio", {
      "redirect-fixture.mjs": `
        import fs from "node:fs";
        fs.writeSync(2, "PRE.");
        fs.closeSync(2);
        const fd = fs.openSync(process.argv[2], "w");
        // On POSIX, open() returns the lowest free descriptor. fd 2 was just
        // closed, so reopening must hand it back.
        process.stdout.write(String(fd));
        fs.writeSync(2, "POST.");
      `,
    });
    const redirected = path.join(String(dir), "redirected.txt");
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "redirect-fixture.mjs"), redirected],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("2");
    // Writes after the reopen land in the new file; the original stderr pipe
    // only keeps the byte written before the close.
    expect(stderr).toBe("PRE.");
    expect(readFileSync(redirected, "utf8")).toBe("POST.");
    expect(exitCode).toBe(0);
  });

  // On Windows, libuv's fs__close no-ops for fd <= 2 (as does Node), so the
  // descriptor is never really closed and the second close cannot raise EBADF.
  it.skipIf(isWindows)("closeSync throws EBADF on a double close of fd 2", async () => {
    using dir = tempDir("fs-close-stdio-dbl", {
      "double-close-fixture.mjs": `
        import fs from "node:fs";
        fs.closeSync(2);
        try {
          fs.closeSync(2);
          console.log("no-throw");
        } catch (e) {
          console.log(e.code);
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "double-close-fixture.mjs")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("EBADF");
    expect(exitCode).toBe(0);
  });
});
