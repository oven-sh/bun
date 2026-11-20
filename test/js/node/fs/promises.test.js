import { bunEnv, bunExe, nodeExeAtLeast, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";
const assert = require("assert");
const os = require("os");
const fs = require("fs");
const fsPromises = require("fs/promises");
const access = fsPromises.access;
const open = fsPromises.open;
const copyFile = fsPromises.copyFile;
const statfs = fsPromises.statfs;
const unlink = fsPromises.unlink;
const readFile = fsPromises.readFile;

//
//
//

async function expectReject(fprom, obj) {
  try {
    await fprom();
    expect.unreachable();
  } catch (e) {
    for (const key of Object.keys(obj)) {
      expect(e[key]).toBe(obj[key]);
    }
  }
}

async function executeOnHandle(func) {
  let dest;
  let handle;
  try {
    [dest, handle] = await getHandle();
    await func([dest, handle]);
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

async function getHandle() {
  const d = await tmpDir();
  const p = join(d, "baz.fixture.js");
  await copyFile(join(import.meta.dir, "baz.fixture.js"), p);
  await access(p);
  return [p, await open(p, "r+")];
}

let fsPromisesTestIndex = 0;
async function tmpDir() {
  return tempDirWithFiles(`fspromisestest-${fsPromisesTestIndex++}`, {
    "hello.txt": "",
  });
}

function verifyStatObject(stat) {
  expect(typeof stat).toBe("object");
  expect(typeof stat.dev).toBe("number");
  expect(typeof stat.mode).toBe("number");
}

function verifyStatFsObject(stat, isBigint = false) {
  const valueType = isBigint ? "bigint" : "number";

  expect(typeof stat).toBe("object");
  expect(typeof stat.type).toBe(valueType);
  expect(typeof stat.bsize).toBe(valueType);
  expect(typeof stat.blocks).toBe(valueType);
  expect(typeof stat.bfree).toBe(valueType);
  expect(typeof stat.bavail).toBe(valueType);
  expect(typeof stat.files).toBe(valueType);
  expect(typeof stat.ffree).toBe(valueType);
}

//
//
//

it("should exist", () => {
  assert.strictEqual(fsPromises, fs.promises);
  assert.strictEqual(fsPromises.constants, fs.constants);
});

it("should be enumerable", () => {
  assert.strictEqual(Object.prototype.propertyIsEnumerable.call(fs, "promises"), true);
});

describe("the shape of each function", () => {
  // node -p 'require("fs/promises").<name>.length', v26.12.1
  const nodeLengths = {
    access: 1,
    appendFile: 3,
    chmod: 2,
    chown: 3,
    copyFile: 3,
    cp: 3,
    glob: 2,
    lchmod: 2,
    lchown: 3,
    link: 2,
    lstat: 1,
    lutimes: 3,
    mkdir: 2,
    mkdtemp: 2,
    mkdtempDisposable: 2,
    open: 3,
    opendir: 3,
    readFile: 2,
    readdir: 2,
    readlink: 2,
    realpath: 2,
    rename: 2,
    rm: 2,
    rmdir: 2,
    stat: 1,
    statfs: 1,
    symlink: 3,
    truncate: 1,
    unlink: 1,
    utimes: 3,
    watch: 1,
    writeFile: 3,
  };
  // Node's fs/promises has none of these. They are as they were: seven still count the callback of the callback form.
  const bunOnlyLengths = {
    close: 1,
    exists: 0,
    fchmod: 3,
    fchown: 4,
    fdatasync: 2,
    fstat: 1,
    fsync: 2,
    ftruncate: 1,
    futimes: 4,
    read: 6,
    readv: 3,
    write: 6,
    writev: 3,
  };
  const nodeNames = Object.keys(nodeLengths);
  const lengthsOf = (object, names) => Object.fromEntries(names.map(name => [name, object[name]?.length]));
  const printLengths = /* js */ `
    const fsPromises = require("node:fs/promises");
    const lengths = {};
    for (const key in fsPromises) if (typeof fsPromises[key] === "function") lengths[key] = fsPromises[key].length;
    console.log(JSON.stringify(lengths));
  `;

  it("functions have Node's length", async () => {
    expect(lengthsOf(fsPromises, nodeNames)).toEqual(nodeLengths);
    expect(lengthsOf(await import("node:fs/promises"), nodeNames)).toEqual(nodeLengths);
  });

  const node = nodeExeAtLeast("26.3.0");
  it.skipIf(!node)("Node has the lengths of that table", async () => {
    await using proc = Bun.spawn({ cmd: [node, "-e", printLengths], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lengths = JSON.parse(stdout || "{}");
    expect({ lengths: Object.fromEntries(nodeNames.map(name => [name, lengths[name]])), exitCode }, stderr).toEqual({
      lengths: nodeLengths,
      exitCode: 0,
    });
  });

  it("functions that Node does not have keep their length", () => {
    const others = Object.keys(fsPromises).filter(
      key => typeof fsPromises[key] === "function" && !(key in nodeLengths),
    );
    expect(lengthsOf(fsPromises, others)).toEqual(bunOnlyLengths);
  });

  it("FileHandle methods have Node's length", async () => {
    // Each method of Object.getOwnPropertyNames(Object.getPrototypeOf(await fsPromises.open(path))), v26.12.1
    const nodeFileHandleLengths = {
      appendFile: 2,
      chmod: 1,
      chown: 2,
      createReadStream: 0,
      createWriteStream: 0,
      datasync: 0,
      getAsyncId: 0,
      read: 4,
      readFile: 1,
      readLines: 0,
      readableWebStream: 0,
      readv: 2,
      stat: 1,
      sync: 0,
      truncate: 0,
      utimes: 2,
      write: 4,
      writeFile: 2,
      writev: 2,
    };
    await using handle = await fsPromises.open(import.meta.path);
    expect(lengthsOf(Object.getPrototypeOf(handle), Object.keys(nodeFileHandleLengths))).toEqual(nodeFileHandleLengths);
  });

  it("functions keep their name, their kind and the attributes of name and length", () => {
    const attributes = { writable: false, enumerable: false, configurable: true };
    const actual = {};
    const expected = {};
    // Not glob, watch and opendir: their kind or their name is not Node's.
    for (const name of nodeNames.filter(name => !["glob", "watch", "opendir"].includes(name))) {
      const fn = fsPromises[name];
      const { length, name: nameDescriptor } = Object.getOwnPropertyDescriptors(fn);
      actual[name] = {
        kind: fn.constructor.name,
        keys: Reflect.ownKeys(fn),
        length: { ...length, value: undefined },
        name: nameDescriptor,
      };
      expected[name] = {
        kind: "AsyncFunction",
        keys: ["length", "name"],
        length: { value: undefined, ...attributes },
        name: { value: name, ...attributes },
      };
    }
    expect(actual).toEqual(expected);
  });

  // Neither a node.fs trace category nor a replaced Object.defineProperty may change a length.
  it.concurrent.each([
    ["--trace-event-categories node.fs", ["--trace-event-categories", "node.fs"], ""],
    [
      "Object.defineProperty replaced before the first require",
      [],
      /* js */ `
        const defineProperty = Object.defineProperty;
        Object.defineProperty = function (target, key, descriptor) {
          return typeof target === "function" ? target : defineProperty(target, key, descriptor);
        };
      `,
    ],
  ])("in a process with %s", async (_, flags, before) => {
    // The trace log goes to the working directory.
    using dir = tempDir("fs-promises-lengths", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "-e", before + printLengths],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ lengths: JSON.parse(stdout || "{}"), exitCode }, stderr).toEqual({
      lengths: { ...nodeLengths, ...bunOnlyLengths },
      exitCode: 0,
    });
  });
});

describe("arguments", () => {
  // Every call gets a directory of its own: { file, other, dir/, symlink -> file }.
  let count = 0;
  function fixture(root) {
    const dir = join(String(root), String(count++));
    fs.mkdirSync(join(dir, "dir"), { recursive: true });
    fs.writeFileSync(join(dir, "file"), "hello");
    fs.writeFileSync(join(dir, "other"), "other file");
    fs.symlinkSync("file", join(dir, "symlink"));
    return dir;
  }
  const clean = (text, dir) => text.replaceAll(dir, "<dir>").replace(/tmp-\w{6}/g, "tmp-<random>");

  function describeValue(value, dir) {
    if (typeof value === "string") return clean(value, dir);
    if (Buffer.isBuffer(value)) return `Buffer ${clean(value.toString(), dir)}`;
    if (Array.isArray(value)) return value.map(item => describeValue(item, dir)).sort();
    if (value === null || typeof value !== "object") return typeof value === "bigint" ? `${value}n` : value;
    const link = typeof value.isSymbolicLink === "function" ? ` link:${value.isSymbolicLink()}` : "";
    const name = typeof value.name === "string" ? ` ${value.name}` : "";
    return `${value.constructor.name}${name}${link} ${Object.keys(value).map(key => typeof value[key])}`;
  }

  // What the call answers or fails with, and what the directory holds afterwards.
  async function outcomeOf(call, dir) {
    let outcome;
    try {
      outcome = { value: describeValue(await call(), dir) };
    } catch (error) {
      outcome = { error: [error.code, clean(error.message, dir)] };
    }
    outcome.left = fs.readdirSync(dir).map(name => {
      const stats = fs.lstatSync(join(dir, name));
      const kind = stats.isSymbolicLink() ? `->${fs.readlinkSync(join(dir, name))}` : stats.isFile() ? stats.size : "/";
      return clean(`${name} ${kind} ${(stats.mode & 0o777).toString(8)} ${stats.nlink}`, dir);
    });
    outcome.left.sort();
    return outcome;
  }

  const owner = [process.getuid?.() ?? 0, process.getgid?.() ?? 0];
  // The last argument of a list is one whose effect shows.
  const lists = {
    access: dir => [join(dir, "file"), 8],
    appendFile: dir => [join(dir, "file"), "6162", { encoding: "hex" }],
    chmod: dir => [join(dir, "file"), 0o600],
    chown: dir => [join(dir, "file"), ...owner],
    copyFile: dir => [join(dir, "file"), join(dir, "other"), fs.constants.COPYFILE_EXCL],
    lchown: dir => [join(dir, "symlink"), ...owner],
    link: dir => [join(dir, "file"), join(dir, "hard")],
    lstat: dir => [join(dir, "symlink"), { bigint: true }],
    lutimes: dir => [join(dir, "symlink"), 1, 2],
    mkdir: dir => [join(dir, "made", "deep"), { recursive: true }],
    mkdtemp: dir => [join(dir, "tmp-"), { encoding: "buffer" }],
    readFile: dir => [join(dir, "file"), { encoding: "hex" }],
    readdir: dir => [dir, { withFileTypes: true }],
    readlink: dir => [join(dir, "symlink"), { encoding: "buffer" }],
    realpath: dir => [join(dir, "symlink"), { encoding: "buffer" }],
    rename: dir => [join(dir, "file"), join(dir, "renamed")],
    stat: dir => [join(dir, "symlink"), { bigint: true }],
    statfs: dir => [dir, { bigint: true }],
    symlink: dir => [join(dir, "file"), join(dir, "made"), "bogus"],
    truncate: dir => [join(dir, "file"), 2],
    unlink: dir => [join(dir, "file")],
    utimes: dir => [join(dir, "file"), 1, 2],
    writeFile: dir => [join(dir, "file"), "6162", { encoding: "hex" }],
  };
  // Only macOS has lchmod.
  if (fs.constants.O_SYMLINK !== undefined) lists.lchmod = dir => [join(dir, "symlink"), 0o600];
  const syncFormOf = name => (name === "realpath" ? fs.realpathSync.native : fs[`${name}Sync`]);

  // The sync form gets the caller's list as it is, so a promise form that drops, adds or swaps an argument differs.
  it.each(Object.keys(lists))("%s settles as its sync form returns or throws, for the same arguments", async name => {
    using root = tempDir("fs-promises-arguments", {});
    const { length } = lists[name]("");
    const changes = { "two more": args => [...args, "more", () => {}] };
    for (let given = 0; given <= length; given++) {
      changes[`${given} given`] = args => args.slice(0, given);
      changes[`${given} given, then undefined`] = args =>
        Array.from({ length: length + 1 }, (_, i) => (i < given ? args[i] : undefined));
    }
    const actual = {};
    const expected = {};
    for (const [label, change] of Object.entries(changes)) {
      let dir = fixture(root);
      const given = change(lists[name](dir));
      actual[label] = await outcomeOf(() => fsPromises[name](...given), dir);
      dir = fixture(root);
      const same = change(lists[name](dir));
      expected[label] = await outcomeOf(() => syncFormOf(name)(...same), dir);
    }
    expect(actual).toEqual(expected);
    // A list is one that its function reads to the end: with all of it the outcome is not that of a shorter one.
    expect(expected[`${length} given`]).not.toEqual(expected[`${length - 1} given`]);
  });
});

describe.concurrent("node.fs.async trace events", () => {
  async function eventsOf(flags, script) {
    // The trace log goes to the working directory.
    using dir = tempDir("fs-promises-trace", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "-e", script],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }, stderr).toEqual({ stdout: "done\n", exitCode: 0 });
    return JSON.parse(fs.readFileSync(join(String(dir), "node_trace.1.log"), "utf8"))
      .traceEvents.filter(event => event.ph === "b" && event.cat.includes("node.fs.async"))
      .map(event => event.name);
  }
  const calls = last => /* js */ `
    (async () => {
      fs.mkdirSync("made");
      await fsPromises.access("made");
      await fsPromises.stat("made");
      await fsPromises.lstat("made");
      await fsPromises.readdir("made");
      await fsPromises.rename("made", "moved");
      await fsPromises.chmod("moved", 0o755);
      ${last}
      console.log("done");
    })();
  `;
  // What Node v26.12.1 writes for these calls.
  const events = ["access", "stat", "lstat", "scandir", "rename", "chmod"];

  it("with a category of the command line", async () => {
    const script = `
      const fs = require("node:fs");
      const fsPromises = require("node:fs/promises");
      ${calls(`await fsPromises.utimes("moved", 1, 2);`)}
    `;
    expect(await eventsOf(["--trace-event-categories", "node.fs.async"], script)).toEqual([...events, "utime"]);
  });

  // A call by name reads the operation each time, so tracing that starts after the module loaded sees it.
  it("with tracing enabled after the first require", async () => {
    const script = `
      const fs = require("node:fs");
      const fsPromises = require("node:fs/promises");
      require("node:trace_events").createTracing({ categories: ["node.fs.async"] }).enable();
      ${calls("// Not utimes: it keeps the operation that it found when the module loaded, and Node traces it here.")}
    `;
    expect(await eventsOf([], script)).toEqual(events);
  });
});

describe("access", () => {
  it("should work", async () => {
    await access(__filename, 0);
  });

  it("should fail on non-existant files", async () => {
    await expectReject(() => access("this file does not exist", 0), {
      code: "ENOENT",
    });
  });

  it.skip("should fail on non-existant modes", async () => {
    await expectReject(() => access(__filename, 8), {
      code: "ERR_OUT_OF_RANGE",
    });
  });

  it.skip("should fail on object as the 2nd argument", async () => {
    await expectReject(
      () =>
        access(__filename, {
          [Symbol.toPrimitive]() {
            return 5;
          },
        }),
      {
        code: "ERR_INVALID_ARG_TYPE",
      },
    );
  });
});

describe("open", () => {
  it("should work", async () => {
    await using _ = await open(__filename);
  });

  it("should return an object", async () => {
    await using fh = await open(__filename);
    assert.strictEqual(typeof fh, "object");
    assert.strictEqual(typeof fh.fd, "number");
  });

  it("should be closable", async () => {
    const fh = await open(__filename);
    await fh.close();
  });
});

describe("more", () => {
  it("is an object", async () => {
    await executeOnHandle(async ([_, handle]) => {
      assert.strictEqual(typeof handle, "object");
    });
  });

  it("stat", async () => {
    await executeOnHandle(async ([_, handle]) => {
      let stats = await handle.stat();
      verifyStatObject(stats);
      assert.strictEqual(stats.size, 35);

      await handle.truncate(1);

      stats = await handle.stat();
      verifyStatObject(stats);
      assert.strictEqual(stats.size, 1);

      stats = await handle.stat();
      verifyStatObject(stats);

      await handle.datasync();
      await handle.sync();
    });
  });

  it.skip("statfs", async () => {
    await executeOnHandle(async ([dest, _]) => {
      const statFs = await statfs(dest);
      verifyStatFsObject(statFs);
    });
  });

  it.skip("statfs bigint", async () => {
    await executeOnHandle(async ([dest, _]) => {
      const statFs = await statfs(dest, { bigint: true });
      verifyStatFsObject(statFs, true);
    });
  });

  it.skip("", async () => {
    await executeOnHandle(async ([dest, handle]) => {
      const buf = Buffer.from("DAWGS WIN");
      const bufLen = buf.length;
      await handle.write(buf);
      const ret = await handle.read(Buffer.alloc(bufLen), 0, 0, 0);
      assert.strictEqual(ret.bytesRead, 0);
      await unlink(dest);
    });
  });
});

test("writing to file in append mode works", async () => {
  const tempFile = os.tmpdir() + "/" + Date.now() + ".txt";

  const f = await open(tempFile, "a");

  await f.writeFile("test\n");
  await f.appendFile("test\n");
  await f.write("test\n");
  await f.datasync();

  await f.close();

  expect((await readFile(tempFile)).toString()).toEqual("test\ntest\ntest\n");
});

test("appendFile with flag 'ax' rejects with EEXIST on an existing file", async () => {
  const dir = tempDirWithFiles("appendfile-exclusive-flag", { "existing.txt": "keep" });
  const existing = join(dir, "existing.txt");
  await expectReject(() => fsPromises.appendFile(existing, "more", { flag: "ax" }), {
    code: "EEXIST",
    syscall: "open",
  });
  expect(await readFile(existing, "utf8")).toEqual("keep");

  const fresh = join(dir, "fresh.txt");
  await fsPromises.appendFile(fresh, "first", { flag: "ax" });
  await fsPromises.appendFile(fresh, "second", { flag: "a" });
  expect(await readFile(fresh, "utf8")).toEqual("firstsecond");
});

test("errors from fs.promises include async stack frames", async () => {
  async function level3() {
    await readFile("/nonexistent-path/does-not-exist.txt");
  }
  async function level2() {
    await level3();
  }
  async function level1() {
    await level2();
  }

  let caught;
  try {
    await level1();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  expect(caught.stack).toContain("at async level3");
  expect(caught.stack).toContain("at async level2");
  expect(caught.stack).toContain("at async level1");
});

test("fs.promises async stack through Promise subclass", async () => {
  class MyPromise extends Promise {}

  async function caller() {
    await MyPromise.resolve().then(() => readFile("/nonexistent-path/x.txt"));
  }

  let caught;
  try {
    await caller();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  // Subclass .then() may not preserve the reaction chain — must not crash.
  expect(typeof caught.stack === "string" || caught.stack === undefined).toBe(true);
});

test("fs.promises async stack through custom thenable", async () => {
  async function caller() {
    const thenable = {
      then(onFulfilled, onRejected) {
        return readFile("/nonexistent-path/x.txt").then(onFulfilled, onRejected);
      },
    };
    await thenable;
  }

  let caught;
  try {
    await caller();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  // Custom thenables break the direct reaction chain — must not crash.
  expect(typeof caught.stack === "string" || caught.stack === undefined).toBe(true);
});

test("fs.promises async stack with Promise.all", async () => {
  async function caller() {
    await Promise.all([readFile("/nonexistent-path/a.txt"), readFile("/nonexistent-path/b.txt")]);
  }

  let caught;
  try {
    await caller();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  // Promise.all uses combinator context — must not crash.
  expect(typeof caught.stack === "string" || caught.stack === undefined).toBe(true);
});

it("an unused FileHandle.writer() does not prevent close()", async () => {
  await using dir = tempDir("unused-writer", { "x.txt": "hello" });
  const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
  fh.writer(); // never written to, never ended
  // must not hang: the writer only refs the handle once a write happens
  await fh.close();
  expect(fh.fd).toBe(-1);
});

it("sources created before close() refuse to use the stale fd", async () => {
  await using dir = tempDir("stale-fd", { "x.txt": "hello" });
  const file = join(dir, "x.txt");

  // writer
  {
    const fh = await fsPromises.open(file, "r+");
    const w = fh.writer();
    await fh.close();
    await expect(w.write(Buffer.from("a"))).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
    expect(() => w.writeSync(Buffer.from("a"))).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  }
  // pull
  {
    const fh = await fsPromises.open(file, "r");
    const src = fh.pull();
    await fh.close();
    await expect(
      (async () => {
        for await (const _ of src);
      })(),
    ).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
  }
  // pullSync
  {
    const fh = await fsPromises.open(file, "r");
    const src = fh.pullSync();
    await fh.close();
    expect(() => {
      for (const _ of src);
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  }
});

it("rm and promises.rm report ERR_FS_EISDIR for directories like rmSync", async () => {
  await using dir = tempDir("rm-eisdir", { "sub/a.txt": "x" });
  const target = join(dir, "sub");
  await expect(fsPromises.rm(target)).rejects.toMatchObject({ code: "ERR_FS_EISDIR" });
  const { promise, resolve } = Promise.withResolvers();
  fs.rm(target, err => resolve(err));
  expect((await promise)?.code).toBe("ERR_FS_EISDIR");
  // directory is still removable the supported way
  await fsPromises.rm(target, { recursive: true });
  expect(fs.existsSync(target)).toBe(false);
});

it("close() while an operation is in flight actually closes the fd", async () => {
  await using dir = tempDir("deferred-close", { "x.txt": "hello" });
  const fh = await fsPromises.open(join(dir, "x.txt"), "r");
  const fd = fh.fd;
  // take an extra ref so close() defers, then release it
  const read = fh.read(Buffer.alloc(5), 0, 5, 0);
  const closed = fh.close();
  await read;
  await closed;
  expect(fh.fd).toBe(-1);
  // the deferred path must have issued the real close; nothing else runs in
  // this process between the close and this check, so EBADF is deterministic
  expect(() => fs.fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
});

it("fail()/end() with autoClose defer the close past an in-flight write", async () => {
  await using dir = tempDir("writer-teardown", { "a.bin": "", "b.bin": "" });
  // fail() while a large write is on the threadpool must not close the fd
  // under it; the write completes, then the handle closes.
  {
    const fh = await fsPromises.open(join(dir, "a.bin"), "w");
    const w = fh.writer({ autoClose: true });
    const big = Buffer.alloc(8 << 20, 65);
    const pending = w.write(big);
    w.fail(new Error("stop"));
    await pending; // must not reject with EBADF
    expect(fs.statSync(join(dir, "a.bin")).size).toBe(big.byteLength);
    expect(fh.fd).toBe(-1); // deferred teardown closed the handle
  }
  // end() while a write is pending waits for it and reports all bytes
  {
    const fh = await fsPromises.open(join(dir, "b.bin"), "w");
    const w = fh.writer({ autoClose: true });
    const big = Buffer.alloc(8 << 20, 66);
    const pending = w.write(big);
    const total = await w.end();
    await pending;
    expect(total).toBe(big.byteLength);
    expect(fs.statSync(join(dir, "b.bin")).size).toBe(big.byteLength);
    expect(fh.fd).toBe(-1);
  }
});

it("teardown waits for every concurrent in-flight write", async () => {
  await using dir = tempDir("writer-concurrent", { "a.bin": "" });
  const fh = await fsPromises.open(join(dir, "a.bin"), "w");
  const w = fh.writer({ autoClose: true, start: 0 });
  const big = Buffer.alloc(4 << 20, 65);
  // two unawaited writes in flight; the first one finishing must not run the
  // deferred teardown while the second is still on the threadpool
  const p1 = w.write(big);
  const p2 = w.write(big);
  w.fail(new Error("stop"));
  await p1;
  await p2; // must not reject with EBADF
  expect(fs.statSync(join(dir, "a.bin")).size).toBe(big.byteLength * 2);
  expect(fh.fd).toBe(-1);
});

// node rejects abortable fs APIs with an AbortError (an Error whose code is the
// string "ABORT_ERR", whose message has no trailing period, and whose cause is
// signal.reason), never with the raw DOMException held in signal.reason (whose
// .code is the number 20 and whose message ends in a period).
describe("AbortSignal rejections use node's AbortError shape", () => {
  function expectNodeAbortError(err, reason) {
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DOMException);
    expect({ name: err.name, code: err.code, message: err.message }).toEqual({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
    });
    expect(err.cause).toBe(reason);
  }

  test("readFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-readfile", { "f.txt": "hello" });
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.readFile(join(dir, "f.txt"), { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("readFile with a custom abort reason", async () => {
    await using dir = tempDir("fs-abort-readfile-reason", { "f.txt": "hello" });
    const reason = new Error("my reason");
    expect.assertions(4);
    try {
      await fsPromises.readFile(join(dir, "f.txt"), { signal: AbortSignal.abort(reason) });
    } catch (err) {
      expectNodeAbortError(err, reason);
    }
  });

  test("readFile aborted while in flight", async () => {
    await using dir = tempDir("fs-abort-readfile-inflight", { "f.txt": "hello" });
    const ac = new AbortController();
    const reason = new Error("stop");
    const promise = fsPromises.readFile(join(dir, "f.txt"), { signal: ac.signal });
    ac.abort(reason);
    expect.assertions(4);
    try {
      await promise;
    } catch (err) {
      expectNodeAbortError(err, reason);
    }
  });

  // abort() with no reason stores the signal's lazily-created DOMException in a
  // common-reason slot; the cause must still be that exact object, not a copy.
  test("readFile aborted while in flight with the default abort reason", async () => {
    await using dir = tempDir("fs-abort-readfile-inflight-default", { "f.txt": "hello" });
    const ac = new AbortController();
    const promise = fsPromises.readFile(join(dir, "f.txt"), { signal: ac.signal });
    ac.abort();
    expect.assertions(4);
    try {
      await promise;
    } catch (err) {
      expectNodeAbortError(err, ac.signal.reason);
    }
  });

  test("appendFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-appendfile", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.appendFile(join(dir, "f.txt"), "data", { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-writefile", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.writeFile(join(dir, "f.txt"), "data", { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile of an async iterable with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-writefile-iter", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.writeFile(
        join(dir, "f.txt"),
        (async function* () {
          yield "a";
        })(),
        { signal },
      );
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile of an async iterable aborted between chunks", async () => {
    await using dir = tempDir("fs-abort-writefile-iter-inflight", {});
    const ac = new AbortController();
    expect.assertions(4);
    try {
      await fsPromises.writeFile(
        join(dir, "f.txt"),
        (async function* () {
          yield "a";
          ac.abort();
          yield "b";
        })(),
        { signal: ac.signal },
      );
    } catch (err) {
      expectNodeAbortError(err, ac.signal.reason);
    }
  });

  test("callback readFile and writeFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-callback", { "f.txt": "hello" });
    const signal = AbortSignal.abort();
    const readErr = await new Promise(resolve => fs.readFile(join(dir, "f.txt"), { signal }, resolve));
    expectNodeAbortError(readErr, signal.reason);
    const writeErr = await new Promise(resolve => fs.writeFile(join(dir, "o.txt"), "x", { signal }, resolve));
    expectNodeAbortError(writeErr, signal.reason);
  });
});
