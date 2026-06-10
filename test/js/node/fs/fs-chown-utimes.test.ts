import { describe, expect, it } from "bun:test";
import { tmpdirSync } from "harness";
import fs from "node:fs";
import { join } from "node:path";

// chown/fchown/lchown share one uid/gid reader and utimes/futimes/lutimes
// share one atime/mtime reader in src/runtime/node/node_fs.rs, so every
// sibling must validate identically and name the failing argument itself.

describe.concurrent("chown/fchown/lchown argument validation", () => {
  it("validates uid and gid to [-1, 2**32 - 1] with the argument's own name", () => {
    const tmp = join(tmpdirSync(), "chown-args.txt");
    fs.writeFileSync(tmp, "x");
    const fd = fs.openSync(tmp, "r+");
    try {
      const variants: ((uid: any, gid: any) => void)[] = [
        (uid, gid) => fs.chownSync(tmp, uid, gid),
        (uid, gid) => fs.fchownSync(fd, uid, gid),
        (uid, gid) => fs.lchownSync(tmp, uid, gid),
      ];
      for (const call of variants) {
        // -1 ("leave unchanged") and the u32 maximum are both in range.
        expect(() => call(-1, -1)).not.toThrow();
        expect(() => call(2 ** 32 - 1, 2 ** 32 - 1)).not.toThrow();
        expect(() => call(-2, 0)).toThrow(
          RangeError('The value of "uid" is out of range. It must be >= -1 and <= 4294967295. Received -2'),
        );
        expect(() => call(0, 2 ** 32)).toThrow(
          RangeError('The value of "gid" is out of range. It must be >= -1 and <= 4294967295. Received 4294967296'),
        );
        expect(() => call(1.5, 0)).toThrow(
          RangeError('The value of "uid" is out of range. It must be an integer. Received 1.5'),
        );
        expect(() => call(0, "a")).toThrow(
          TypeError("The \"gid\" argument must be of type number. Received type string ('a')"),
        );
        expect(() => call(0, "a")).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
      }
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe.concurrent("utimes/futimes/lutimes argument validation", () => {
  it("rejects non-finite and non-number atime/mtime with the argument's own name", () => {
    const tmp = join(tmpdirSync(), "utimes-args.txt");
    fs.writeFileSync(tmp, "x");
    const fd = fs.openSync(tmp, "r+");
    try {
      const variants: ((atime: any, mtime: any) => void)[] = [
        (atime, mtime) => fs.utimesSync(tmp, atime, mtime),
        (atime, mtime) => fs.futimesSync(fd, atime, mtime),
        (atime, mtime) => fs.lutimesSync(tmp, atime, mtime),
      ];
      for (const call of variants) {
        expect(() => call(0, 0)).not.toThrow();
        expect(() => call(new Date(), new Date())).not.toThrow();
        for (const bad of [{}, NaN, Infinity, -Infinity]) {
          expect(() => call(bad, 0)).toThrow(TypeError("atime must be a number or a Date"));
          expect(() => call(0, bad)).toThrow(TypeError("mtime must be a number or a Date"));
        }
        expect(() => call({}, 0)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
      }
    } finally {
      fs.closeSync(fd);
    }
  });

  it("utimesSync follows symlinks and lutimesSync does not", () => {
    const dir = tmpdirSync();
    const target = join(dir, "target.txt");
    const link = join(dir, "link");
    fs.writeFileSync(target, "x");
    fs.symlinkSync(target, link);

    const linkTime = new Date("2000-01-02T03:04:05.000Z");
    fs.lutimesSync(link, linkTime, linkTime);
    const targetTime = new Date("2010-06-07T08:09:10.000Z");
    fs.utimesSync(link, targetTime, targetTime);

    expect({
      link: fs.lstatSync(link).mtime.toISOString(),
      target: fs.statSync(target).mtime.toISOString(),
    }).toEqual({
      link: linkTime.toISOString(),
      target: targetTime.toISOString(),
    });
  });
});
