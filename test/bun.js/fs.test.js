import { describe, expect, it } from "bun:test";
import { gc, gcTick } from "gc";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFile,
  readFileSync,
  readSync,
  writeFileSync,
  writeSync,
  statSync,
  lstatSync,
  copyFileSync,
  rmSync,
  createReadStream,
} from "node:fs";
import { join } from "node:path";

const Buffer = globalThis.Buffer || Uint8Array;

if (!import.meta.dir) {
  import.meta.dir = ".";
}

describe("copyFileSync", () => {
  it("should work for files < 128 KB", () => {
    const tempdir = `/tmp/fs.test.js/${Date.now()}/1234/hi`;
    expect(existsSync(tempdir)).toBe(false);
    expect(tempdir.includes(mkdirSync(tempdir, { recursive: true }))).toBe(
      true
    );

    // that don't exist
    copyFileSync(import.meta.path, tempdir + "/copyFileSync.js");
    expect(existsSync(tempdir + "/copyFileSync.js")).toBe(true);
    expect(readFileSync(tempdir + "/copyFileSync.js", "utf-8")).toBe(
      readFileSync(import.meta.path, "utf-8")
    );

    // that do exist
    copyFileSync(tempdir + "/copyFileSync.js", tempdir + "/copyFileSync.js1");
    writeFileSync(tempdir + "/copyFileSync.js1", "hello");
    copyFileSync(tempdir + "/copyFileSync.js1", tempdir + "/copyFileSync.js");

    expect(readFileSync(tempdir + "/copyFileSync.js", "utf-8")).toBe("hello");
  });

  it("should work for files > 128 KB ", () => {
    const tempdir = `/tmp/fs.test.js/${Date.now()}-1/1234/hi`;
    expect(existsSync(tempdir)).toBe(false);
    expect(tempdir.includes(mkdirSync(tempdir, { recursive: true }))).toBe(
      true
    );
    var buffer = new Int32Array(128 * 1024);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = i % 256;
    }

    const hash = Bun.hash(buffer.buffer);
    writeFileSync(tempdir + "/copyFileSync.src.blob", buffer.buffer);

    expect(existsSync(tempdir + "/copyFileSync.dest.blob")).toBe(false);
    expect(existsSync(tempdir + "/copyFileSync.src.blob")).toBe(true);
    copyFileSync(
      tempdir + "/copyFileSync.src.blob",
      tempdir + "/copyFileSync.dest.blob"
    );

    expect(Bun.hash(readFileSync(tempdir + "/copyFileSync.dest.blob"))).toBe(
      hash
    );
    buffer[0] = 255;
    writeFileSync(tempdir + "/copyFileSync.src.blob", buffer.buffer);
    copyFileSync(
      tempdir + "/copyFileSync.src.blob",
      tempdir + "/copyFileSync.dest.blob"
    );
    expect(Bun.hash(readFileSync(tempdir + "/copyFileSync.dest.blob"))).toBe(
      Bun.hash(buffer.buffer)
    );
  });
});

describe("mkdirSync", () => {
  it("should create a directory", () => {
    const tempdir = `/tmp/fs.test.js/${Date.now()}/1234/hi`;
    expect(existsSync(tempdir)).toBe(false);
    expect(tempdir.includes(mkdirSync(tempdir, { recursive: true }))).toBe(
      true
    );
    expect(existsSync(tempdir)).toBe(true);
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
  const path = `/tmp/fs-test-empty-dir-${(
    Math.random() * 100000 +
    100
  ).toString(32)}`;
  mkdirSync(path, { recursive: true });
  expect(readdirSync(path).length).toBe(0);
});

it("readdirSync works on directories with under 32 files", () => {
  const path = `/tmp/fs-test-one-dir-${(Math.random() * 100000 + 100).toString(
    32
  )}`;
  mkdirSync(path, { recursive: true });
  writeFileSync(`${path}/a`, "a");
  const results = readdirSync(path);
  expect(results.length).toBe(1);
  expect(results[0]).toBe("a");
});

it("readdirSync throws when given a file path", () => {
  try {
    readdirSync(import.meta.path);
    throw new Error("should not get here");
  } catch (exception) {
    expect(exception.name).toBe("ENOTDIR");
  }
});

it("readdirSync throws when given a path that doesn't exist", () => {
  try {
    readdirSync(import.meta.path + "/does-not-exist/really");
    throw new Error("should not get here");
  } catch (exception) {
    expect(exception.name).toBe("ENOTDIR");
  }
});

it("readdirSync throws when given a file path with trailing slash", () => {
  try {
    readdirSync(import.meta.path + "/");
    throw new Error("should not get here");
  } catch (exception) {
    expect(exception.name).toBe("ENOTDIR");
  }
});

describe("readSync", () => {
  const firstFourBytes = new Uint32Array(
    new TextEncoder().encode("File").buffer
  )[0];
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
});

describe("writeSync", () => {
  it("works with a position set to 0", () => {
    const fd = openSync(import.meta.dir + "/writeFileSync.txt", "w+");
    const four = new Uint8Array(4);

    {
      const count = writeSync(fd, new TextEncoder().encode("File"), 0, 4, 0);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });
  it("works without position set", () => {
    const fd = openSync(import.meta.dir + "/writeFileSync.txt", "w+");
    const four = new Uint8Array(4);
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
    const text = readFileSync(
      new URL("file://" + import.meta.dir + "/readFileSync.txt"),
      "utf8"
    );
    gc();
    expect(text).toBe("File read successfully");
  });

  it("works with special files in the filesystem", () => {
    {
      const text = readFileSync("/dev/null", "utf8");
      gc();
      expect(text).toBe("");
    }

    if (process.platform === "linux") {
      const text = readFileSync("/proc/filesystems");
      gc();
      expect(text.length > 0).toBe(true);
    }
  });

  it("returning Buffer works", () => {
    const text = readFileSync(import.meta.dir + "/readFileSync.txt");
    const encoded = [
      70, 105, 108, 101, 32, 114, 101, 97, 100, 32, 115, 117, 99, 99, 101, 115,
      115, 102, 117, 108, 108, 121,
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
          70, 105, 108, 101, 32, 114, 101, 97, 100, 32, 115, 117, 99, 99, 101,
          115, 115, 102, 117, 108, 108, 121,
        ];
        gc();
        for (let i = 0; i < encoded.length; i++) {
          expect(text[i]).toBe(encoded[i]);
        }
        resolve(true);
      });
    });
  });
});

describe("writeFileSync", () => {
  it("works", () => {
    const path = `/tmp/${Date.now()}.writeFileSync.txt`;
    writeFileSync(path, "File written successfully", "utf8");

    expect(readFileSync(path, "utf8")).toBe("File written successfully");
  });

  it("returning Buffer works", () => {
    const buffer = new Buffer([
      70, 105, 108, 101, 32, 119, 114, 105, 116, 116, 101, 110, 32, 115, 117,
      99, 99, 101, 115, 115, 102, 117, 108, 108, 121,
    ]);
    const path = `/tmp/${Date.now()}.blob.writeFileSync.txt`;
    writeFileSync(path, buffer);
    const out = readFileSync(path);

    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(out[i]);
    }
  });
  it("returning ArrayBuffer works", () => {
    const buffer = new Buffer([
      70, 105, 108, 101, 32, 119, 114, 105, 116, 116, 101, 110, 32, 115, 117,
      99, 99, 101, 115, 115, 102, 117, 108, 108, 121,
    ]);
    const path = `/tmp/${Date.now()}.blob2.writeFileSync.txt`;
    writeFileSync(path, buffer);
    const out = readFileSync(path);

    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(out[i]);
    }
  });
});

describe("lstat", () => {
  it("file metadata is correct", () => {
    const fileStats = lstatSync(
      new URL("./fs-stream.js", import.meta.url)
        .toString()
        .slice("file://".length - 1)
    );
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(true);
    expect(fileStats.isDirectory()).toBe(false);
  });

  it("folder metadata is correct", () => {
    const fileStats = lstatSync(
      new URL("../../test", import.meta.url)
        .toString()
        .slice("file://".length - 1)
    );
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(false);
    expect(fileStats.isDirectory()).toBe(true);
  });

  it("symlink metadata is correct", () => {
    const linkStats = lstatSync(
      new URL("./fs-stream.link.js", import.meta.url)
        .toString()
        .slice("file://".length - 1)
    );
    expect(linkStats.isSymbolicLink()).toBe(true);
    expect(linkStats.isFile()).toBe(false);
    expect(linkStats.isDirectory()).toBe(false);
  });
});

describe("stat", () => {
  it("file metadata is correct", () => {
    const fileStats = statSync(
      new URL("./fs-stream.js", import.meta.url)
        .toString()
        .slice("file://".length - 1)
    );
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(true);
    expect(fileStats.isDirectory()).toBe(false);
  });

  it("folder metadata is correct", () => {
    const fileStats = statSync(
      new URL("../../test", import.meta.url)
        .toString()
        .slice("file://".length - 1)
    );
    expect(fileStats.isSymbolicLink()).toBe(false);
    expect(fileStats.isFile()).toBe(false);
    expect(fileStats.isDirectory()).toBe(true);
  });
});

describe("rm", () => {
  it("removes a file", () => {
    const path = `/tmp/${Date.now()}.rm.txt`;
    writeFileSync(path, "File written successfully", "utf8");
    expect(existsSync(path)).toBe(true);
    rmSync(path);
    expect(existsSync(path)).toBe(false);
  });

  it("removes a dir", () => {
    const path = `/tmp/${Date.now()}.rm.dir`;
    try {
      mkdirSync(path);
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmSync(path);
    expect(existsSync(path)).toBe(false);
  });

  it("removes a dir recursively", () => {
    const path = `/tmp/${Date.now()}.rm.dir/foo/bar`;
    try {
      mkdirSync(path, { recursive: true });
    } catch (e) {}
    expect(existsSync(path)).toBe(true);
    rmSync(join(path, "../../"), { recursive: true });
    expect(existsSync(path)).toBe(false);
  });
});

describe("createReadStream", () => {
  it("works (1 chunk)", async () => {
    return await new Promise((resolve, reject) => {
      var stream = createReadStream(import.meta.dir + "/readFileSync.txt", {});

      stream.on("error", (e) => {
        reject(e);
      });

      stream.on("data", (chunk) => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.length).toBe("File read successfully".length);
        expect(chunk.toString()).toBe("File read successfully");
      });

      stream.on("close", () => {
        resolve(true);
      });
    });
  });

  it("works (22 chunk)", async () => {
    var stream = createReadStream(import.meta.dir + "/readFileSync.txt", {
      highWaterMark: 1,
    });

    var data = readFileSync(import.meta.dir + "/readFileSync.txt", "utf8");
    var i = 0;
    return await new Promise((resolve) => {
      stream.on("data", (chunk) => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(chunk.length).toBe(1);
        expect(chunk.toString()).toBe(data[i++]);
      });

      stream.on("end", () => {
        resolve(true);
      });
    });
  });
});
