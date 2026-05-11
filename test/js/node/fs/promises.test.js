import { tempDirWithFiles } from "harness";
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
    await open(__filename);
  });

  it("should return an object", async () => {
    const fh = await open(__filename);
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
