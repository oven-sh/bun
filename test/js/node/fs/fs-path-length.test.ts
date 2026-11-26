import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMacOS, isPosix, isWindows, tempDir } from "harness";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

// The limit of a path (4096 on Linux) is in UTF-8 bytes, not in characters
// (UTF-16 code units): multi-byte characters expand when encoded as UTF-8.
describe.if(isPosix)("path length validation with multi-byte characters", () => {
  // U+4E00 (一) is a CJK character that is 3 bytes in UTF-8 (0xE4 0xB8 0x80).
  // 2000 such characters = 2000 UTF-16 code units but 6000 UTF-8 bytes,
  // which exceeds the 4096-byte PathBuffer.
  const cjkPath = "\u4e00".repeat(2000);

  it("rejects overly long multi-byte paths in openSync", () => {
    expect(() => fs.openSync(cjkPath, "r")).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in readFileSync", () => {
    expect(() => fs.readFileSync(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in statSync", () => {
    expect(() => fs.statSync(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in realpathSync", () => {
    expect(() => fs.realpathSync(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in async readFile", async () => {
    expect(async () => await fs.promises.readFile(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in async stat", async () => {
    expect(async () => await fs.promises.stat(cjkPath)).toThrow("ENAMETOOLONG");
  });

  // 2-byte UTF-8 characters (U+0080 to U+07FF range)
  it("rejects overly long 2-byte UTF-8 paths", () => {
    // U+00E9 (é) is 2 bytes in UTF-8. 3000 chars = 6000 bytes > 4096
    const accentPath = "\u00e9".repeat(3000);
    expect(() => fs.statSync(accentPath)).toThrow("ENAMETOOLONG");
  });

  // PATH_MAX (Linux 4096, macOS 1024) includes the NUL terminator, so the
  // longest usable path string is PATH_MAX-1 bytes. A path of exactly
  // PATH_MAX bytes used to pass the `0..=MAX_PATH_BYTES` length guard, then
  // `slice_z` had no room for the NUL and returned "" — the
  // syscall ran on the empty path and came back ENOENT instead of
  // ENAMETOOLONG. PATH_MAX-1 and PATH_MAX+1 were already correct; only this
  // one length was wrong. The kernel rejects all three now.
  describe.each([
    ["Linux", isLinux, 4096],
    ["macOS", isMacOS, 1024],
  ])("PATH_MAX boundary on %s", (_, isHost, PATH_MAX) => {
    const mk = (n: number) => "/tmp/" + Buffer.alloc(n - 5, "A").toString();
    it.if(isHost).each([PATH_MAX - 1, PATH_MAX, PATH_MAX + 1])(
      "returns ENAMETOOLONG for a %i-byte path (sync/promises/Buffer)",
      async n => {
        const p = mk(n);
        expect(() => fs.statSync(p)).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        expect(() => fs.openSync(p, "r")).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        expect(() => fs.mkdirSync(p)).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        expect(() => fs.statSync(Buffer.from(p))).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        await expect(fs.promises.stat(p)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
      },
    );
  });

  // Verify that the process does not crash - the key property is that these
  // throw a proper JS error rather than segfaulting.
  it("does not crash with 4-byte UTF-8 characters exceeding buffer", () => {
    // U+1F600 (😀) is 4 bytes in UTF-8, 2 UTF-16 code units (surrogate pair).
    // 1500 emoji = 3000 UTF-16 code units but 6000 UTF-8 bytes > 4096
    const emojiPath = "\u{1F600}".repeat(1500);
    expect(() => fs.statSync(emojiPath)).toThrow("ENAMETOOLONG");
  });
});

// On Windows, PATH_MAX_WIDE is 32767 u16 code units. normalizePathWindows
// copies the input and/or the joined cwd + input into pooled [32767]u16
// buffers at several points. Each copy site must return ENAMETOOLONG rather
// than writing past the buffer when the input would not fit.
describe.if(isWindows)("path length validation in normalizePathWindows", () => {
  // 32765 ASCII chars → 32765 u16 after UTF-8→UTF-16 conversion (fits in the
  // 32767-u16 conversion buffer). Even a minimal cwd like "C:\" (3 chars)
  // brings the joined length past 32767.
  const longRelative = "./" + Buffer.alloc(32763, "a").toString();

  it("rejects overly long relative paths in readdirSync", () => {
    expect(() => fs.readdirSync(longRelative)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long relative paths in writeFileSync", () => {
    expect(() => fs.writeFileSync(longRelative, "")).toThrow("ENAMETOOLONG");
  });

  // A relative path containing no '\\', '/', or '.' takes the early-return
  // branch that copies the path directly into `buf` and appends a NUL. When
  // path.len == buf.len the NUL write would land one past the end.
  it("rejects a PATH_MAX_WIDE-length separator-free relative path", () => {
    const noSep = Buffer.alloc(32767, "a").toString();
    expect(() => fs.readdirSync(noSep)).toThrow("ENAMETOOLONG");
  });

  // The UTF-8→UTF-16 conversion at the top of normalizePathWindows forwards
  // only the output pointer to simdutf, which performs no bounds checking.
  // Nothing bounds the path before it, so inputs of more than 32767 bytes
  // reach the conversion.
  it("rejects relative paths longer than the UTF-16 conversion buffer", () => {
    const tooLong = Buffer.alloc(40000, "a").toString();
    expect(() => fs.readdirSync(tooLong)).toThrow("ENAMETOOLONG");
  });

  // Absolute drive-letter paths are normalized into `buf` with an NT object
  // prefix (\??\ or \??\UNC\) and NUL terminator. node:fs prepends
  // a \\?\ long-path prefix before reaching normalizePathWindows, so size
  // the input so that prefixed length (+4) still fits the 32767-u16
  // conversion buffer and the headroom guard is what rejects it.
  it("rejects overly long absolute drive-letter paths", () => {
    const absLong = "C:\\" + Buffer.alloc(32757, "a").toString();
    expect(() => fs.readdirSync(absLong)).toThrow("ENAMETOOLONG");
  });

  // Device paths (\\.\...) are copied verbatim into `buf` with a trailing NUL.
  it("rejects overly long device paths", () => {
    const devLong = "\\\\.\\" + Buffer.alloc(32763, "a").toString();
    expect(() => fs.readdirSync(devLong)).toThrow("ENAMETOOLONG");
  });
});

// On Windows, node:fs converted paths to UTF-16 into fixed-size wide buffers
// (PathLike.osPath: a [32767]u16 WPathBuffer; PathLike.osPathKernel32: the
// 98302-byte PathBuffer viewed as [49151]u16). For an ASCII path of 32767
// chars or more the UTF-8→UTF-16 conversion wrote past the wide buffer
// (simdutf performs no bounds checking), panicking with "range end index
// 49151 out of range for slice of length 49150". Paths that long can't
// exist on NT (PATH_MAX_WIDE caps them), so the conversions reject them:
// exists → false, other ops → ENAMETOOLONG.
describe.if(isWindows)("path length validation against UTF-16 conversion buffers", () => {
  // Used to overflow the 49151-u16 osPathKernel32 view (exists, recursive
  // mkdir, copyFile src).
  const kernel32Long = "C:\\" + Buffer.alloc(49200, "a").toString();
  // Used to overflow the 32767-u16 WPathBuffer (copyFile dest, cp).
  const wideLong = "C:\\" + Buffer.alloc(40000, "a").toString();

  it("existsSync returns false instead of crashing", () => {
    expect(fs.existsSync(kernel32Long)).toBe(false);
  });

  // https://github.com/oven-sh/bun/issues/20258 — drive-letter-less paths of
  // 49151..98302 chars crashed existsSync (49150 and 98303 already worked:
  // the former fit the buffer, the latter exceeded the UTF-8 byte check).
  it.each([49150, 49151, 64503, 98302, 98303])(
    "existsSync handles path length %i across the buffer boundaries (#20258)",
    len => {
      expect(fs.existsSync(Buffer.alloc(len, "A").toString())).toBe(false);
    },
  );

  it("rejects over-long paths in accessSync", () => {
    expect(() => fs.accessSync(kernel32Long)).toThrow("ENAMETOOLONG");
  });

  // slice_z's drive-letter branch adds the \\?\ prefix in the 98302-byte
  // PathBuffer; for byte lengths in (98297, 98302] the prefixed copy used to
  // write past the buffer. It must fall back to the unprefixed form and
  // surface the syscall's error (which one depends on the OS/filesystem).
  it("handles drive-letter paths in the last bytes below MAX_PATH_BYTES", () => {
    const p = "C:\\" + Buffer.alloc(98297, "a").toString();
    expect(() => fs.statSync(p)).toThrow(/ENOENT|ENAMETOOLONG|EINVAL/);
  });

  it("rejects over-long paths in recursive mkdirSync", () => {
    expect(() => fs.mkdirSync(kernel32Long, { recursive: true })).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long src paths in copyFileSync", () => {
    expect(() => fs.copyFileSync(kernel32Long, "copy-file-dest-does-not-matter.txt")).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long dest paths in copyFileSync", () => {
    expect(() => fs.copyFileSync("copy-file-src-does-not-matter.txt", wideLong)).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long paths in cpSync", () => {
    expect(() => fs.cpSync(wideLong, "cp-dest-does-not-matter.txt")).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long paths in async fs.promises.mkdir", async () => {
    expect(async () => await fs.promises.mkdir(kernel32Long, { recursive: true })).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long Buffer paths", () => {
    expect(() => fs.mkdirSync(Buffer.from(kernel32Long), { recursive: true })).toThrow("ENAMETOOLONG");
  });

  it("still accepts multi-byte paths that are long in bytes but within the UTF-16 bound", () => {
    // 150 × 200-char CJK segments: 90152 UTF-8 bytes — past the UTF-16-unit
    // limit in bytes — but only 30152 UTF-16 units, so
    // the conversion must compute the exact length and accept it.
    // Each component stays under NTFS's 255-unit limit so the only possible
    // syscall failure is non-existence: copyFileSync (which checks both
    // paths against the guard and does not swallow errors) must get past
    // the length guard and fail with ENOENT — not ENAMETOOLONG.
    const segment = Buffer.alloc(600, "\u4e00").toString();
    const p = "C:\\" + Array(150).fill(segment).join("\\");
    expect(() => fs.copyFileSync(p, "copy-file-dest-does-not-matter.txt")).toThrow("ENOENT");
  });
});

describe.if(isWindows)("Buffer paths containing malformed byte sequences", () => {
  it("decodes each malformed byte as U+FFFD in the resulting file name", () => {
    using dir = tempDir("fs-buffer-path-malformed", {});
    const base = Buffer.from(String(dir) + "\\");
    fs.mkdirSync(String(dir) + "\\sub");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("sub"), Buffer.from([0xc0, 0xaf]), Buffer.from("file")]), "1");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("a"), Buffer.from([0xc0, 0xae]), Buffer.from("b")]), "2");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("c"), Buffer.from([0xc0, 0x80]), Buffer.from("d")]), "3");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("e"), Buffer.from([0xc2]), Buffer.from("F")]), "4");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("g"), Buffer.from([0xe0, 0x80, 0x80]), Buffer.from("h")]), "5");
    expect(fs.readdirSync(String(dir)).sort()).toEqual([
      "a\uFFFD\uFFFDb",
      "c\uFFFD\uFFFDd",
      "e\uFFFDF",
      "g\uFFFD\uFFFD\uFFFDh",
      "sub",
      "sub\uFFFD\uFFFDfile",
    ]);
    expect(fs.readdirSync(String(dir) + "\\sub")).toEqual([]);
    expect(fs.readFileSync(String(dir) + "\\e\uFFFDF", "utf8")).toBe("4");
  });
});

// No path is refused for its length before the syscall, so the syscall's
// ENAMETOOLONG arrives like any other of its errors: through the callback, and
// with its name. The lengths clear MAX_PATH_BYTES on every platform: 4096
// Linux, 1024 macOS, 98302 Windows.
//
// On Windows most of these operations go to libuv, as in Node. Which error
// it gives such a path depends on the operation, and `chown` and `lchown` do
// nothing there.
describe.each([
  // One name over NAME_MAX.
  ["one name", (isWindows ? "C:\\" : "/") + Buffer.alloc(isWindows ? 100_000 : 5_000, "a").toString()],
  // No name is too long. Only the whole path is, and by far.
  ["many folders", (isWindows ? "C:\\" : "/") + Buffer.alloc(200_000, isWindows ? "a\\" : "a/").toString() + "b"],
])("callback APIs report a path longer than MAX_PATH_BYTES through the callback, %s", (_, tooLong) => {
  const tooLongLength = tooLong.length;
  // The operand that is not under test. Every operation below fails on
  // `tooLong`, so this path is never created.
  const other = "fs-path-length-other-operand";

  type Callback = (err: unknown) => void;
  // [name, call, where node reports `tooLong` (mkdtemp appends its suffix to
  // it), the `err.syscall` of node on Linux where Bun has the same]
  const calls: [string, (cb: Callback) => void, "path" | "dest" | undefined, string | undefined][] = [
    ["access", cb => fs.access(tooLong, cb), "path", "access"],
    ["appendFile", cb => fs.appendFile(tooLong, "x", cb), "path", "open"],
    ["chmod", cb => fs.chmod(tooLong, 0o644, cb), "path", "chmod"],
    ["chown", cb => fs.chown(tooLong, 0, 0, cb), "path", "chown"],
    ["copyFile src", cb => fs.copyFile(tooLong, other, cb), "path", "copyfile"],
    ["copyFile dest", cb => fs.copyFile(import.meta.path, tooLong, cb), "dest", "copyfile"],
    ["cp src", cb => fs.cp(tooLong, other, cb), "path", "lstat"],
    ["cp dest", cb => fs.cp(import.meta.path, tooLong, cb), "path", "lstat"],
    ["lchown", cb => fs.lchown(tooLong, 0, 0, cb), "path", "lchown"],
    ["link existingPath", cb => fs.link(tooLong, other, cb), "path", "link"],
    ["link newPath", cb => fs.link(import.meta.path, tooLong, cb), "dest", "link"],
    ["lstat", cb => fs.lstat(tooLong, cb), "path", "lstat"],
    ["lutimes", cb => fs.lutimes(tooLong, 0, 0, cb), "path", "lutime"],
    ["mkdir", cb => fs.mkdir(tooLong, cb), "path", "mkdir"],
    ["mkdir recursive", cb => fs.mkdir(tooLong, { recursive: true }, cb), "path", "mkdir"],
    ["mkdtemp", cb => fs.mkdtemp(tooLong, cb), undefined, "mkdtemp"],
    ["open", cb => fs.open(tooLong, "r", cb), "path", "open"],
    ["opendir", cb => fs.opendir(tooLong, cb), "path", "opendir"],
    ["readdir", cb => fs.readdir(tooLong, cb), "path", "scandir"],
    ["readdir recursive", cb => fs.readdir(tooLong, { recursive: true }, cb), "path", undefined],
    ["readFile", cb => fs.readFile(tooLong, cb), "path", "open"],
    ["readlink", cb => fs.readlink(tooLong, cb), "path", "readlink"],
    ["realpath", cb => fs.realpath(tooLong, cb), "path", "lstat"],
    ["realpath.native", cb => fs.realpath.native(tooLong, cb), "path", "realpath"],
    ["rename oldPath", cb => fs.rename(tooLong, other, cb), "path", "rename"],
    ["rename newPath", cb => fs.rename(other, tooLong, cb), "dest", "rename"],
    ["rm", cb => fs.rm(tooLong, cb), "path", undefined],
    ["rmdir", cb => fs.rmdir(tooLong, cb), "path", "rmdir"],
    ["stat", cb => fs.stat(tooLong, cb), "path", "stat"],
    ["stat with a Buffer path", cb => fs.stat(Buffer.from(tooLong), cb), "path", "stat"],
    ["stat with a file: URL path", cb => fs.stat(pathToFileURL(tooLong), cb), "path", "stat"],
    ["statfs", cb => fs.statfs(tooLong, cb), "path", "statfs"],
    ["symlink path", cb => fs.symlink(other, tooLong, cb), "dest", "symlink"],
    ["symlink target", cb => fs.symlink(tooLong, other, cb), "path", "symlink"],
    ["truncate", cb => fs.truncate(tooLong, cb), "path", undefined],
    ["unlink", cb => fs.unlink(tooLong, cb), "path", "unlink"],
    ["utimes", cb => fs.utimes(tooLong, 0, 0, cb), "path", "utime"],
    ["writeFile", cb => fs.writeFile(tooLong, "x", cb), "path", "open"],
  ];

  it.each(calls)("fs.%s", async (name, call, reportedAs, syscall) => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    let returned = false;
    let calledBeforeReturning = false;
    call(err => {
      calledBeforeReturning = !returned;
      resolve(err);
    });
    returned = true;
    const err = (await promise) as NodeJS.ErrnoException | null;
    expect(calledBeforeReturning).toBe(false);
    expect(fs.existsSync(other)).toBe(false);
    if (isWindows) {
      const doesNothing = name === "chown" || name === "lchown";
      expect(err?.code ?? null).toEqual(doesNothing ? null : expect.stringMatching(/^(ENAMETOOLONG|ENOENT|EINVAL)$/));
      return;
    }
    expect(err!.code).toBe("ENAMETOOLONG");
    if (reportedAs) {
      expect(err![reportedAs]).toBe(tooLong);
    }
    if (isLinux && syscall) {
      expect(err!.syscall).toBe(syscall);
    }
  });

  // https://github.com/oven-sh/bun/issues/25659
  it("a relative path is reported the same way (#25659)", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const order: string[] = [];
    fs.readFile(Buffer.alloc(tooLongLength, "a").toString(), err => {
      order.push("callback");
      resolve(err);
    });
    order.push("returned");
    const err = (await promise) as NodeJS.ErrnoException;
    expect(order).toEqual(["returned", "callback"]);
    expect(err.code).toMatch(isWindows ? /^(ENAMETOOLONG|ENOENT|EINVAL)$/ : /^ENAMETOOLONG$/);
  });

  it("fs.exists answers false", async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    fs.exists(tooLong, resolve);
    expect(await promise).toBe(false);
  });

  // Node validates the other arguments before issuing the syscall, so an
  // invalid option still throws synchronously and wins over the path's errno.
  it("an invalid option still throws synchronously", () => {
    expect(() => fs.readdir(tooLong, { encoding: "bogus" as BufferEncoding }, () => {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => fs.readFile(tooLong, { encoding: "bogus" as BufferEncoding }, () => {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it.skipIf(isWindows)("the sync variants throw it, naming the path and the syscall", () => {
    const stat = { code: "ENAMETOOLONG", path: tooLong, syscall: "stat" };
    expect(() => fs.statSync(tooLong)).toThrow(expect.objectContaining(stat));
    expect(() => fs.statSync(Buffer.from(tooLong))).toThrow(expect.objectContaining(stat));
    expect(() => fs.renameSync(other, tooLong)).toThrow(
      expect.objectContaining({ code: "ENAMETOOLONG", syscall: "rename", dest: tooLong }),
    );
  });

  it.if(isWindows)("the sync variants throw what the system says", () => {
    const refused = expect.objectContaining({ code: expect.stringMatching(/^(ENAMETOOLONG|ENOENT|EINVAL)$/) });
    expect(() => fs.statSync(tooLong)).toThrow(refused);
    expect(() => fs.statSync(Buffer.from(tooLong))).toThrow(refused);
    expect(() => fs.renameSync(other, tooLong)).toThrow(refused);
  });

  it.skipIf(isWindows)("the promise variants reject with it, naming the path and the syscall", async () => {
    const failure = ({ code, path, syscall }: NodeJS.ErrnoException) => ({ code, path, syscall });
    expect({
      stat: await fs.promises.stat(tooLong).catch(failure),
      readFile: await fs.promises.readFile(tooLong).catch(failure),
      unlink: await fs.promises.unlink(tooLong).catch(failure),
    }).toEqual({
      stat: { code: "ENAMETOOLONG", path: tooLong, syscall: "stat" },
      readFile: { code: "ENAMETOOLONG", path: tooLong, syscall: "open" },
      unlink: { code: "ENAMETOOLONG", path: tooLong, syscall: "unlink" },
    });
  });
});

// The sync calls of a VM share one buffer for the path, and it only grows.
// A sanitizer build keeps freed memory for a while, so the number says nothing there.
it.skipIf(isASAN || isDebug)("the memory for a long path is freed after the call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const fs = require("node:fs");
        function attempt(path) {
          try {
            fs.statSync(path);
          } catch (error) {
            return error.code;
          }
        }
        Bun.gc(true);
        const before = process.memoryUsage.rss();
        const code = attempt(Buffer.alloc(64 << 20, "a/").toString());
        // The VM keeps the last error that was thrown, and that one has the path.
        attempt("does-not-exist");
        Bun.gc(true);
        console.log(code, Math.round((process.memoryUsage.rss() - before) / 1024 / 1024));`,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const [code, grownMiB] = stdout.trim().split(" ");
  // On Windows libuv picks the error.
  expect(code).toMatch(/^(ENAMETOOLONG|ENOENT|EINVAL)$/);
  // The path is 64 MiB.
  expect(Number(grownMiB)).toBeLessThan(32);
  expect(exitCode).toBe(0);
});
