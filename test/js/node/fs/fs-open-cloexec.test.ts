import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isLinux, isMacOS, tempDir } from "harness";
import fs from "node:fs";
import { join } from "node:path";

// libuv ORs O_CLOEXEC into every fs open, so a descriptor a script opens
// through node:fs never leaks into a child that a native addon forks
// outside of Bun.spawn (system(3), forkpty, posix_spawn).
function hasCloexec(fd: number): boolean {
  if (isLinux) {
    const info = fs.readFileSync(`/proc/self/fdinfo/${fd}`, "utf8");
    const flags = parseInt(info.match(/^flags:\s*(\d+)/m)![1], 8);
    return (flags & 0o2000000) !== 0;
  }
  const libc = dlopen("/usr/lib/libSystem.B.dylib", {
    fcntl: { args: ["int", "int"], returns: "int" },
  });
  try {
    const F_GETFD = 1;
    const FD_CLOEXEC = 1;
    return (libc.symbols.fcntl(fd, F_GETFD) & FD_CLOEXEC) !== 0;
  } finally {
    libc.close();
  }
}

describe.skipIf(!isLinux && !isMacOS)("node:fs opens set O_CLOEXEC", () => {
  test("fs.openSync", () => {
    using dir = tempDir("fs-cloexec", { "a.txt": "hello" });
    for (const flags of ["r", "w", "a", "r+", fs.constants.O_RDONLY]) {
      const fd = fs.openSync(join(String(dir), "a.txt"), flags);
      try {
        expect(hasCloexec(fd)).toBe(true);
      } finally {
        fs.closeSync(fd);
      }
    }
  });

  test("fs.promises.open", async () => {
    using dir = tempDir("fs-cloexec", { "a.txt": "hello" });
    await using handle = await fs.promises.open(join(String(dir), "a.txt"), "r+");
    expect(hasCloexec(handle.fd)).toBe(true);
  });

  test("fs.open callback", async () => {
    using dir = tempDir("fs-cloexec", { "a.txt": "hello" });
    const fd = await new Promise<number>((resolve, reject) =>
      fs.open(join(String(dir), "a.txt"), "r", (err, fd) => (err ? reject(err) : resolve(fd))),
    );
    try {
      expect(hasCloexec(fd)).toBe(true);
    } finally {
      fs.closeSync(fd);
    }
  });

  test("fs.createReadStream and fs.createWriteStream", async () => {
    using dir = tempDir("fs-cloexec", { "a.txt": "hello" });
    const rs = fs.createReadStream(join(String(dir), "a.txt"));
    const ws = fs.createWriteStream(join(String(dir), "b.txt"));
    const [rfd, wfd] = await Promise.all([
      new Promise<number>((resolve, reject) => rs.once("open", resolve).once("error", reject)),
      new Promise<number>((resolve, reject) => ws.once("open", resolve).once("error", reject)),
    ]);
    try {
      expect(hasCloexec(rfd)).toBe(true);
      expect(hasCloexec(wfd)).toBe(true);
    } finally {
      rs.close();
      ws.close();
    }
  });

  test("user flags are kept", () => {
    using dir = tempDir("fs-cloexec", { "log.txt": "ab" });
    const fd = fs.openSync(join(String(dir), "log.txt"), fs.constants.O_WRONLY | fs.constants.O_APPEND);
    try {
      // O_APPEND ignores the position argument, so "y" lands at EOF, not at 0.
      fs.writeSync(fd, "x");
      fs.writeSync(fd, "y", 0);
      expect(hasCloexec(fd)).toBe(true);
    } finally {
      fs.closeSync(fd);
    }
    expect(fs.readFileSync(join(String(dir), "log.txt"), "utf8")).toBe("abxy");
  });
});
