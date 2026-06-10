import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/32047
describe("utimes-family errors report node's syscall names", () => {
  const missing = join(tmpdir(), `utimes-syscall-${Math.random().toString(36).slice(2)}`, "f");
  const badFd = 2147483640;

  it("utimesSync reports 'utime'", () => {
    expect(() => fs.utimesSync(missing, 0, 0)).toThrow(
      expect.objectContaining({
        code: "ENOENT",
        syscall: "utime",
        message: `ENOENT: no such file or directory, utime '${missing}'`,
      }),
    );
  });

  it("lutimesSync reports 'lutime'", () => {
    expect(() => fs.lutimesSync(missing, 0, 0)).toThrow(
      expect.objectContaining({
        code: "ENOENT",
        syscall: "lutime",
        message: `ENOENT: no such file or directory, lutime '${missing}'`,
      }),
    );
  });

  it("futimesSync reports 'futime'", () => {
    expect(() => fs.futimesSync(badFd, 0, 0)).toThrow(
      expect.objectContaining({
        code: "EBADF",
        syscall: "futime",
        message: "EBADF: bad file descriptor, futime",
      }),
    );
  });

  it("promises.utimes reports 'utime'", async () => {
    await expect(fs.promises.utimes(missing, 0, 0)).rejects.toMatchObject({
      code: "ENOENT",
      syscall: "utime",
    });
  });

  it("promises.lutimes reports 'lutime'", async () => {
    await expect(fs.promises.lutimes(missing, 0, 0)).rejects.toMatchObject({
      code: "ENOENT",
      syscall: "lutime",
    });
  });

  it("futimes callback reports 'futime'", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    fs.futimes(badFd, 0, 0, resolve);
    expect(await promise).toMatchObject({
      code: "EBADF",
      syscall: "futime",
      message: "EBADF: bad file descriptor, futime",
    });
  });
});
