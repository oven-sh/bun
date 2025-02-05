import { describe, expect, it, spyOn } from "bun:test";
import { bunEnv, bunExe, gc, getMaxFD, isBroken, isIntelMacOS, isWindows, tempDirWithFiles, tmpdirSync } from "harness";
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
  lstatSync,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  openAsBlob,
  openSync,
  promises,
  statfsSync,
  statfs,
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
import { promisify } from "node:util";

import _promises, { type FileHandle } from "node:fs/promises";

import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnSync } from "bun";
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
  expect(res).not.toInclude("1234");
  expect(existsSync(tempdir)).toBe(true);
  return tempdir;
}

it("fs.writeFile(1, data) should work when its inherited", async () => {
  expect([join(import.meta.dir, "fs-writeFile-1-fixture.js"), "1"]).toRun();
});

it("fs.writeFile(2, data) should work when its inherited", async () => {
  expect([join(import.meta.dir, "fs-writeFile-1-fixture.js"), "2"]).toRun();
});

it("fs.writeFile(/dev/null, data) should work", async () => {
  expect([join(import.meta.dir, "fs-writeFile-1-fixture.js"), require("os").devNull]).toRun();
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

it("await readdir #3931", async () => {
  const { exitCode } = spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "./repro-3931.js")],
    env: bunEnv,
    cwd: import.meta.dir,
  });
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

describe("readSync", () => {
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

it("readlink", () => {
  const actual = join(tmpdirSync(), "fs-readlink.txt");
  try {
    unlinkSync(actual);
  } catch (e) {}

  symlinkSync(import.meta.path, actual);

  expect(readlinkSync(actual)).toBe(realpathSync(import.meta.path));
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

    await promises.rmdir(path, { recursive: true });
    expect(existsSync(path + "/file.txt")).toBe(false);
  });
  it("removes a dir recursively", done => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir/foo/bar`;
    try {
      mkdirSync(path, { recursive: true });
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmdir(join(path, "../../"), { recursive: true }, err => {
      try {
        expect(existsSync(path)).toBe(false);
        done(err);
      } catch (e) {
        return done(e);
      } finally {
        done();
      }
    });
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
  it("removes a dir recursively", () => {
    const path = `${tmpdir()}/${Date.now()}.rm.dir/foo/bar`;
    try {
      mkdirSync(path, { recursive: true });
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmdirSync(join(path, "../../"), { recursive: true });
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
      Bun.sleep(1000).then(() => {
        expect(readFileSync(path, "utf8")).toBe("Test file written successfully");
        done();
      });
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
});

describe("fs/promises", () => {
  const { exists, mkdir, readFile, rmdir, stat, writeFile } = promises;

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

  it("readdir(path, {recursive: true}) produces the same result as Node.js", async () => {
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
    const text = await new Response(subprocess.stdout).text();
    const node = JSON.parse(text);
    expect(bun).toEqual(node as string[]);
  }, 100000);

  it("readdir(path, {withFileTypes: true}) produces the same result as Node.js", async () => {
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
    const text = await new Response(subprocess.stdout).text();
    const node = JSON.parse(text);
    expect(bun.length).toEqual(node.length);
    expect([...new Set(node.map(v => v.parentPath ?? v.path))]).toEqual([full]);
    expect([...new Set(bun.map(v => v.parentPath ?? v.path))]).toEqual([full]);
    expect(bun.map(v => join(v.parentPath ?? v.path, v.name)).sort()).toEqual(
      node.map(v => join(v.path, v.name)).sort(),
    );
  }, 100000);

  it("readdir(path, {withFileTypes: true, recursive: true}) produces the same result as Node.js", async () => {
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
    const text = await new Response(subprocess.stdout).text();
    const node = JSON.parse(text);
    expect(bun.length).toEqual(node.length);
    expect(new Set(bun.map(v => v.parentPath ?? v.path))).toEqual(new Set(node.map(v => v.path)));
    expect(bun.map(v => join(v.parentPath ?? v.path, v.name)).sort()).toEqual(
      node.map(v => join(v.path, v.name)).sort(),
    );
  }, 100000);

  it("readdirSync(path, {withFileTypes: true, recursive: true}) produces the same result as Node.js", async () => {
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
    const text = await new Response(subprocess.stdout).text();
    const node = JSON.parse(text);
    expect(bun.length).toEqual(node.length);
    expect(new Set(bun.map(v => v.parentPath ?? v.path))).toEqual(new Set(node.map(v => v.path)));
    expect(bun.map(v => join(v.parentPath ?? v.path, v.name)).sort()).toEqual(
      node.map(v => join(v.path, v.name)).sort(),
    );
  }, 100000);

  for (let withFileTypes of [false, true] as const) {
    const iterCount = 200;
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
    const iterCount = 200;
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
    it("removes a dir recursively", async () => {
      const path = `${tmpdir()}/${Date.now()}.rm.dir/foo/bar`;
      try {
        await mkdir(path, { recursive: true });
      } catch (e) {}
      expect(await exists(path)).toBe(true);
      await rmdir(join(path, "../../"), { recursive: true });
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
    const bigBuffer = new Uint8Array(1024 * 1024 * 1024);
    fd = openSync(dest, "w");
    let offset = 0;
    while (offset < 5 * 1024 * 1024 * 1024) {
      offset += writeSync(fd, bigBuffer, 0, bigBuffer.length, offset);
    }
    fdatasyncSync(fd);
    expect(fstatSync(fd).size).toEqual(offset);
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

  expect(withBigInt.atime.getTime()).toEqual(withoutBigInt.atime.getTime());
  expect(withBigInt.mtime.getTime()).toEqual(withoutBigInt.mtime.getTime());
  expect(withBigInt.ctime.getTime()).toEqual(withoutBigInt.ctime.getTime());
  expect(withBigInt.birthtime.getTime()).toEqual(withoutBigInt.birthtime.getTime());
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

it("open flags verification", async () => {
  const invalid = 4_294_967_296;
  expect(() => fs.open(__filename, invalid, () => {})).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
  expect(() => fs.openSync(__filename, invalid)).toThrowWithCode(RangeError, "ERR_OUT_OF_RANGE");
  expect(async () => await fs.promises.open(__filename, invalid)).toThrow(RangeError);

  expect(() => fs.open(__filename, 4294967298.5, () => {})).toThrow(
    RangeError(`The value of "flags" is out of range. It must be an integer. Received 4294967298.5`),
  );
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

  const bigIntStats = statfsSync(import.meta.path, { bigint: true });
  ["type", "bsize", "blocks", "bfree", "bavail", "files", "ffree"].forEach(k => {
    expect(bigIntStats).toHaveProperty(k);
    expect(bigIntStats[k]).toBeTypeOf("bigint");
  });
});

it("fs.promises.statfs should work", async () => {
  const stats = await fs.promises.statfs(import.meta.path);
  expect(stats).toBeDefined();
});

it("fs.promises.statfs should work with bigint", async () => {
  const stats = await fs.promises.statfs(import.meta.path, { bigint: true });
  expect(stats).toBeDefined();
});

it("fs.statfs should work with bigint", async () => {
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
});

it("fs.statfs should work with bigint", async () => {
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
    it(`${name} (not existing)`, () => {
      const { success } = spawnSync({
        cmd: [bunExe(), "-e", code],
        cwd: workingDir1,
        stdio: ["ignore", "inherit", "inherit"],
        env: bunEnv,
      });
      expect(success).toBeTrue();
    });
  }
  for (const [name, code] of existTests) {
    it(`${name} (existing)`, () => {
      const { success } = spawnSync({
        cmd: [bunExe(), "-e", code],
        cwd: workingDir2,
        stdio: ["ignore", "inherit", "inherit"],
        env: bunEnv,
      });
      expect(success).toBeTrue();
    });
  }
});
