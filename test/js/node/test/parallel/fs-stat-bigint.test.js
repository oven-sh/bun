//#FILE: test-fs-stat-bigint.js
//#SHA1: c8ba0bacb927432a68a677cd3a304e8e058fb070
//-----------------
"use strict";

const fs = require("fs");
const promiseFs = require("fs").promises;
const tmpdir = require("../common/tmpdir");
const { isDate } = require("util").types;
const { inspect } = require("util");

tmpdir.refresh();

let testIndex = 0;

function getFilename() {
  const filename = tmpdir.resolve(`test-file-${++testIndex}`);
  fs.writeFileSync(filename, "test");
  return filename;
}

function verifyStats(bigintStats, numStats, allowableDelta) {
  // allowableDelta: It's possible that the file stats are updated between the
  // two stat() calls so allow for a small difference.
  for (const key of Object.keys(numStats)) {
    const val = numStats[key];
    if (isDate(val)) {
      const time = val.getTime();
      const time2 = bigintStats[key].getTime();
      expect(time - time2).toBeLessThanOrEqual(allowableDelta);
    } else if (key === "mode") {
      expect(bigintStats[key]).toBe(BigInt(val));
      expect(bigintStats.isBlockDevice()).toBe(numStats.isBlockDevice());
      expect(bigintStats.isCharacterDevice()).toBe(numStats.isCharacterDevice());
      expect(bigintStats.isDirectory()).toBe(numStats.isDirectory());
      expect(bigintStats.isFIFO()).toBe(numStats.isFIFO());
      expect(bigintStats.isFile()).toBe(numStats.isFile());
      expect(bigintStats.isSocket()).toBe(numStats.isSocket());
      expect(bigintStats.isSymbolicLink()).toBe(numStats.isSymbolicLink());
    } else if (key.endsWith("Ms")) {
      const nsKey = key.replace("Ms", "Ns");
      const msFromBigInt = bigintStats[key];
      const nsFromBigInt = bigintStats[nsKey];
      const msFromBigIntNs = Number(nsFromBigInt / 10n ** 6n);
      const msFromNum = numStats[key];

      expect(msFromNum - Number(msFromBigInt)).toBeLessThanOrEqual(allowableDelta);
      expect(msFromNum - Number(msFromBigIntNs)).toBeLessThanOrEqual(allowableDelta);
    } else if (Number.isSafeInteger(val)) {
      expect(bigintStats[key]).toBe(BigInt(val));
    } else {
      expect(Number(bigintStats[key]) - val).toBeLessThan(1);
    }
  }
}

const runSyncTest = (func, arg) => {
  const startTime = process.hrtime.bigint();
  const bigintStats = func(arg, { bigint: true });
  const numStats = func(arg);
  const endTime = process.hrtime.bigint();
  const allowableDelta = Math.ceil(Number(endTime - startTime) / 1e6);
  verifyStats(bigintStats, numStats, allowableDelta);
};

test("fs.statSync", () => {
  const filename = getFilename();
  runSyncTest(fs.statSync, filename);
});

if (!process.platform.startsWith("win")) {
  test("fs.lstatSync", () => {
    const filename = getFilename();
    const link = `${filename}-link`;
    fs.symlinkSync(filename, link);
    runSyncTest(fs.lstatSync, link);
  });
}

test("fs.fstatSync", () => {
  const filename = getFilename();
  const fd = fs.openSync(filename, "r");
  runSyncTest(fs.fstatSync, fd);
  fs.closeSync(fd);
});

test("fs.statSync with non-existent file", () => {
  expect(() => fs.statSync("does_not_exist")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  expect(fs.statSync("does_not_exist", { throwIfNoEntry: false })).toBeUndefined();
});

test("fs.lstatSync with non-existent file", () => {
  expect(() => fs.lstatSync("does_not_exist")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  expect(fs.lstatSync("does_not_exist", { throwIfNoEntry: false })).toBeUndefined();
});

test("fs.fstatSync with invalid file descriptor", () => {
  expect(() => fs.fstatSync(9999)).toThrow(expect.objectContaining({ code: "EBADF" }));
  expect(() => fs.fstatSync(9999, { throwIfNoEntry: false })).toThrow(expect.objectContaining({ code: "EBADF" }));
});

const runCallbackTest = (func, arg) => {
  return new Promise(resolve => {
    const startTime = process.hrtime.bigint();
    func(arg, { bigint: true }, (err, bigintStats) => {
      expect(err).toBeFalsy();
      func(arg, (err, numStats) => {
        expect(err).toBeFalsy();
        const endTime = process.hrtime.bigint();
        const allowableDelta = Math.ceil(Number(endTime - startTime) / 1e6);
        verifyStats(bigintStats, numStats, allowableDelta);
        resolve();
      });
    });
  });
};

test("fs.stat callback", async () => {
  const filename = getFilename();
  await runCallbackTest(fs.stat, filename);
});

if (!process.platform.startsWith("win")) {
  test("fs.lstat callback", async () => {
    const filename = getFilename();
    const link = `${filename}-link`;
    fs.symlinkSync(filename, link);
    await runCallbackTest(fs.lstat, link);
  });
}

test("fs.fstat callback", async () => {
  const filename = getFilename();
  const fd = fs.openSync(filename, "r");
  await runCallbackTest(fs.fstat, fd);
  fs.closeSync(fd);
});

const runPromiseTest = async (func, arg) => {
  const startTime = process.hrtime.bigint();
  const bigintStats = await func(arg, { bigint: true });
  const numStats = await func(arg);
  const endTime = process.hrtime.bigint();
  const allowableDelta = Math.ceil(Number(endTime - startTime) / 1e6);
  verifyStats(bigintStats, numStats, allowableDelta);
};

test("promiseFs.stat", async () => {
  const filename = getFilename();
  await runPromiseTest(promiseFs.stat, filename);
});

if (!process.platform.startsWith("win")) {
  test("promiseFs.lstat", async () => {
    const filename = getFilename();
    const link = `${filename}-link`;
    fs.symlinkSync(filename, link);
    await runPromiseTest(promiseFs.lstat, link);
  });
}

test("promiseFs handle.stat", async () => {
  const filename = getFilename();
  const handle = await promiseFs.open(filename, "r");
  const startTime = process.hrtime.bigint();
  const bigintStats = await handle.stat({ bigint: true });
  const numStats = await handle.stat();
  const endTime = process.hrtime.bigint();
  const allowableDelta = Math.ceil(Number(endTime - startTime) / 1e6);
  verifyStats(bigintStats, numStats, allowableDelta);
  await handle.close();
});

test("BigIntStats Date properties can be set before reading them", done => {
  fs.stat(__filename, { bigint: true }, (err, s) => {
    expect(err).toBeFalsy();
    s.atime = 2;
    s.mtime = 3;
    s.ctime = 4;
    s.birthtime = 5;

    expect(s.atime).toBe(2);
    expect(s.mtime).toBe(3);
    expect(s.ctime).toBe(4);
    expect(s.birthtime).toBe(5);
    done();
  });
});

test("BigIntStats Date properties can be set after reading them", done => {
  fs.stat(__filename, { bigint: true }, (err, s) => {
    expect(err).toBeFalsy();
    // eslint-disable-next-line no-unused-expressions
    s.atime, s.mtime, s.ctime, s.birthtime;

    s.atime = 2;
    s.mtime = 3;
    s.ctime = 4;
    s.birthtime = 5;

    expect(s.atime).toBe(2);
    expect(s.mtime).toBe(3);
    expect(s.ctime).toBe(4);
    expect(s.birthtime).toBe(5);
    done();
  });
});

//<#END_FILE: test-fs-stat-bigint.js
