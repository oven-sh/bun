import { afterAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isWindows, tempDir, tmpdirSync, unprivilegedSpawnOptions } from "harness";
import { chmodSync, mkdirSync, readFileSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "path";

// TODO: We do not support mmap() on Windows. Maybe we can add it later.
describe.skipIf(isWindows)("Bun.mmap", async () => {
  await gcTick();
  const path = join(tmpdirSync(), "bun-mmap-test.txt");
  await gcTick();
  await Bun.write(path, "hello");
  await gcTick();

  it("mmap finalizer", async () => {
    let map = Bun.mmap(path);
    await gcTick();
    const map2 = Bun.mmap(path);

    map = null;
    await gcTick();
  });

  it("mmap passed to other syscalls", async () => {
    const map = Bun.mmap(path);
    await gcTick();
    await Bun.write(path + "1", map);
    await gcTick();
    const text = await (await Bun.file(path + "1")).text();
    await gcTick();

    expect(text).toBe(new TextDecoder().decode(map));
  });

  it("mmap sync", async () => {
    const map = Bun.mmap(path);
    await gcTick();
    const map2 = Bun.mmap(path);
    await gcTick();

    const old = map[0];
    await gcTick();
    map[0] = 0;
    await gcTick();
    expect(map2[0]).toBe(0);

    map2[0] = old;
    await gcTick();
    expect(map[0]).toBe(old);
    await gcTick();
    await Bun.write(path, "olleh");
    await gcTick();
    expect(new TextDecoder().decode(map)).toBe("olleh");
    await gcTick();
  });

  it("mmap private", async () => {
    await gcTick();
    const map = Bun.mmap(path, { shared: true });
    await gcTick();
    const map2 = Bun.mmap(path, { shared: false });
    await gcTick();
    const old = map[0];

    await gcTick();
    map2[0] = 0;
    await gcTick();
    expect(map2[0]).toBe(0);
    await gcTick();
    expect(map[0]).toBe(old);
    await gcTick();
  });

  describe("mmap offset returns bytes starting at the requested position", () => {
    const fileSize = 4096 * 3;
    const buf = Buffer.alloc(fileSize);
    for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;
    const dir = tempDir("mmap-offset", {});
    const file = join(String(dir), "data.bin");
    writeFileSync(file, buf);
    afterAll(() => dir[Symbol.dispose]());

    it.each([
      { offset: 0, size: undefined },
      { offset: 1, size: undefined },
      { offset: 100, size: undefined },
      { offset: 4095, size: undefined },
      { offset: 4096, size: undefined },
      { offset: 4097, size: undefined },
      { offset: 100, size: 200 },
      { offset: 4097, size: 10 },
      { offset: 1, size: fileSize * 2 },
    ])("offset=$offset size=$size", async ({ offset, size }) => {
      const map = Bun.mmap(file, size === undefined ? { offset } : { offset, size });
      const wantLen = Math.min(fileSize - offset, size ?? Infinity);
      expect({ length: map.length, first: map[0], last: map[map.length - 1] }).toEqual({
        length: wantLen,
        first: buf[offset],
        last: buf[offset + wantLen - 1],
      });
      expect(Buffer.from(map).equals(buf.subarray(offset, offset + wantLen))).toBe(true);
      await gcTick();
    });
  });

  it("mmap offset with shared mapping writes land at the requested position", () => {
    using dir = tempDir("mmap-offset-write", {});
    const file = join(String(dir), "data.bin");
    writeFileSync(file, Buffer.alloc(4096 * 2, 0));

    const map = Bun.mmap(file, { offset: 100, shared: true });
    map[0] = 0xab;
    map[1] = 0xcd;

    const full = Bun.mmap(file);
    expect({ at0: full[0], at99: full[99], at100: full[100], at101: full[101] }).toEqual({
      at0: 0,
      at99: 0,
      at100: 0xab,
      at101: 0xcd,
    });
  });

  it("mmap offset past EOF throws EINVAL", () => {
    using dir = tempDir("mmap-offset-eof", {});
    const file = join(String(dir), "data.bin");
    writeFileSync(file, Buffer.alloc(50, 0));

    expect(() => Bun.mmap(file, { offset: 100 })).toThrow("EINVAL");
    expect(() => Bun.mmap(file, { offset: 50 })).toThrow("EINVAL");
    expect(() => Bun.mmap(file, { offset: 1, size: 0 })).toThrow("EINVAL");
  });

  // `deep + "/f.txt"` is one byte shorter than the longest path the system takes, so no working directory fits in front of it.
  const deepPath = `const max = process.platform === "linux" ? 4096 : 1024;
let deep = "";
while (deep.length < max - 1 - "/f.txt".length) {
  const separator = deep === "" ? "" : "/";
  deep += separator + Buffer.alloc(Math.min(200, max - 1 - "/f.txt".length - deep.length - separator.length), "d");
}`;

  // `app/cur` links to `releases/v2`, so the system reads `app/cur/..` as `releases`. As text it is `app`.
  function linkedTree(prefix) {
    const dir = tempDir(prefix, {
      "app/config.json": "STALE",
      "app/a/b.txt": "in a folder",
      "releases/config.json": "LIVE!",
      "releases/v2/keep": "",
    });
    symlinkSync("../releases/v2", join(String(dir), "app", "cur"));
    return dir;
  }

  it.concurrent("mmap throws a catchable error for a path that is too long", async () => {
    using dir = tempDir("mmap-long-path", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        // The system gets every path that is shorter than its limit, however long the working directory is.
        `import fs from "node:fs";
const answer = path => {
  try {
    return Buffer.from(Bun.mmap(path)).toString();
  } catch (e) {
    return { code: e.code, syscall: e.syscall };
  }
};
${deepPath}
fs.mkdirSync(deep, { recursive: true });
fs.writeFileSync(deep + "/f.txt", "deep");
const out = {
  oneNameBelowTheLimit: answer(Buffer.alloc(max - 1, "a").toString()),
  nestedBelowTheLimit: answer(deep + "/f.txt"),
  atTheLimit: answer("/" + deep + "/f.txt"),
};
fs.rmSync(deep.slice(0, deep.indexOf("/")), { recursive: true });
console.log(JSON.stringify(out));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
      out: {
        oneNameBelowTheLimit: { code: "ENAMETOOLONG", syscall: "open" },
        nestedBelowTheLimit: "deep",
        // As for node:fs, the system is not asked.
        atTheLimit: { code: "ENAMETOOLONG" },
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  it.concurrent(
    "mmap in a compiled executable names its own files by text and gives the system every other path",
    async () => {
      using dir = linkedTree("mmap-compiled");
      writeFileSync(join(String(dir), "note.txt"), "a note");
      writeFileSync(
        join(String(dir), "main.js"),
        `import fs from "node:fs";
import path from "node:path";
import note from "./note.txt" with { type: "file" };
const root = import.meta.dir;
const disk = process.cwd();
${deepPath}
const shown = text => text.replaceAll(deep, "<deep>").replaceAll(root, "<root>").replaceAll(disk, "<disk>");
const answer = call => {
  try {
    return Buffer.from(call()).toString();
  } catch (e) {
    return { code: e.code, syscall: e.syscall, path: e.path === undefined ? undefined : shown(e.path) };
  }
};
fs.mkdirSync(deep, { recursive: true });
fs.writeFileSync(deep + "/f.txt", "deep");
const out = {
  "embedded file": answer(() => Bun.mmap(note)),
  "embedded file behind ..": answer(() => Bun.mmap(root + "/absent/../" + path.basename(note))),
  "embedded folder": answer(() => Bun.mmap(root)),
  "embedded folder behind ..": answer(() => Bun.mmap(root + "/absent/..")),
  "absent file behind ..": answer(() => Bun.mmap(root + "/absent/../absent.txt")),
  "link/.. on the disk": answer(() => Bun.mmap("app/cur/../config.json")),
  "link/.. on the disk, absolute": answer(() => Bun.mmap(disk + "/app/cur/../config.json")),
  "disk file behind the embedded folder": answer(() => Bun.mmap(root + "/../.." + disk + "/app/config.json")),
  "long relative path": answer(() => Bun.mmap(deep + "/f.txt")),
  "empty path": answer(() => Bun.mmap("")),
};
fs.rmSync(deep.slice(0, deep.indexOf("/")), { recursive: true });
// The system's working directory stays here, where no path below leads to the same file.
process.chdir(disk + "/app");
process.chdir(root);
Object.assign(out, {
  "in the embedded folder: file": answer(() => Bun.mmap(path.basename(note))),
  "in the embedded folder: the folder": answer(() => Bun.mmap(".")),
  "in the embedded folder: absent file": answer(() => Bun.mmap("absent.txt")),
  "in the embedded folder: disk file": answer(() => Bun.mmap("../.." + disk + "/app/config.json")),
  "in the embedded folder: absent disk file": answer(() => Bun.mmap("../.." + disk + "/app/absent.json")),
  "in the embedded folder: long relative path": answer(() => Bun.mmap(deep + "/f.txt")),
  "in the embedded folder: empty path": answer(() => Bun.mmap("")),
});
console.log(JSON.stringify(out));`,
      );
      const executable = join(String(dir), "main");
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "main.js", "--outfile", executable],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const built = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect({ stdout: built[0], stderr: built[1], exitCode: built[2] }).toMatchObject({ exitCode: 0 });
      await using proc = Bun.spawn({
        cmd: [executable],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const fails = (code, path) => ({ code, syscall: "open", path });
      expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
        out: {
          "embedded file": "a note",
          "embedded file behind ..": "a note",
          "embedded folder": fails("EISDIR", "<root>"),
          "embedded folder behind ..": fails("EISDIR", "<root>/absent/.."),
          "absent file behind ..": fails("ENOENT", "<root>/absent/../absent.txt"),
          "link/.. on the disk": "LIVE!",
          "link/.. on the disk, absolute": "LIVE!",
          // As for node:fs, the system does not know the embedded folder.
          "disk file behind the embedded folder": fails("ENOENT", "<root>/../..<disk>/app/config.json"),
          "long relative path": "deep",
          "empty path": { code: "ENOENT", syscall: "open" },
          "in the embedded folder: file": "a note",
          "in the embedded folder: the folder": fails("EISDIR", "."),
          "in the embedded folder: absent file": fails("ENOENT", "absent.txt"),
          "in the embedded folder: disk file": "STALE",
          "in the embedded folder: absent disk file": fails("ENOENT", "../..<disk>/app/absent.json"),
          "in the embedded folder: long relative path": fails("ENAMETOOLONG", "<deep>/f.txt"),
          "in the embedded folder: empty path": { code: "ENOENT", syscall: "open" },
        },
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
  );

  it("mmap maps the file that the system resolves `link/..` to", () => {
    using dir = linkedTree("mmap-link-dotdot");
    const file = `${dir}/app/cur/../config.json`;
    expect(readFileSync(file, "utf8")).toBe("LIVE!");

    const map = Bun.mmap(file);
    expect(Buffer.from(map).toString()).toBe("LIVE!");
    // A write through the shared mapping reaches that file and no other.
    map[0] = "D".charCodeAt(0);
    expect({
      releases: readFileSync(`${dir}/releases/config.json`, "utf8"),
      app: readFileSync(`${dir}/app/config.json`, "utf8"),
    }).toEqual({ releases: "DIVE!", app: "STALE" });
  });

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  it("mmap gives the system a relative path as written, and an error names it so", async () => {
    using dir = linkedTree("mmap-as-written");
    writeFileSync(join(String(dir), "app", "a\\b.txt"), "a backslash in its name");
    // The mode of a directory does not stop root, so the child is not root.
    using unprivileged = unprivilegedSpawnOptions(String(dir));
    symlinkSync("loop", join(String(dir), "loop"));
    const sealed = join(String(dir), "sealed");
    mkdirSync(sealed, { mode: 0o000 });
    // The directory is removed with the tree, which takes a mode that lets it be listed.
    using _ = { [Symbol.dispose]: () => chmodSync(sealed, 0o700) };
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import fs from "node:fs";
const answer = call => {
  try {
    return call();
  } catch (e) {
    return { code: e.code, syscall: e.syscall, path: e.path };
  }
};
const open = path => {
  const fd = fs.openSync(path, "r+");
  try {
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
};
const out = {};
for (const path of process.argv.slice(1)) {
  out[path] = { mmap: answer(() => Buffer.from(Bun.mmap(path)).toString()), open: answer(() => open(path)) };
}
console.log(JSON.stringify(out));`,
        "app/cur/../config.json",
        "app/absent/../config.json",
        "app/config.json/../config.json",
        "app/config.json/.",
        "loop/../app/config.json",
        "sealed/../app/config.json",
        "app/absent.json",
        "app/a\\b.txt",
        "",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const both = answer => ({ mmap: answer, open: answer });
    const fails = (code, path) => both({ code, syscall: "open", path });
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
      out: {
        "app/cur/../config.json": both("LIVE!"),
        "app/absent/../config.json": fails("ENOENT", "app/absent/../config.json"),
        "app/config.json/../config.json": fails("ENOTDIR", "app/config.json/../config.json"),
        "app/config.json/.": fails("ENOTDIR", "app/config.json/."),
        "loop/../app/config.json": fails("ELOOP", "loop/../app/config.json"),
        "sealed/../app/config.json": fails("EACCES", "sealed/../app/config.json"),
        "app/absent.json": fails("ENOENT", "app/absent.json"),
        "app/a\\b.txt": both("a backslash in its name"),
        "": both({ code: "ENOENT", syscall: "open" }),
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  it("mmap of more than 2^32 bytes throws a RangeError instead of aborting", async () => {
    using dir = tempDir("mmap-4gib", {});
    const file = join(String(dir), "big.bin");
    // Sparse: the mappings below cost address space, not memory or disk.
    writeFileSync(file, "");
    truncateSync(file, 2 ** 32 + 4096);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const file = ${JSON.stringify(file)};
const out = {};
try {
  out.wholeFile = Bun.mmap(file).length;
} catch (e) {
  out.wholeFile = e.name;
}
try {
  out.sizeAboveLimit = Bun.mmap(file, { size: 2 ** 32 + 1 }).length;
} catch (e) {
  out.sizeAboveLimit = e.name;
}
out.sizeAtLimit = Bun.mmap(file, { size: 2 ** 32 }).length;
out.smallWindow = Bun.mmap(file, { size: 4096 }).length;
console.log(JSON.stringify(out));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      out: {
        wholeFile: "RangeError",
        sizeAboveLimit: "RangeError",
        sizeAtLimit: 2 ** 32,
        smallWindow: 4096,
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  it("mmap rejects negative offset", () => {
    expect(() => Bun.mmap(path, { offset: -1 })).toThrow("offset must be a non-negative integer");
  });

  it("mmap rejects negative size", () => {
    expect(() => Bun.mmap(path, { size: -1 })).toThrow("size must be a non-negative integer");
  });

  it("mmap rejects non-object options", () => {
    for (const options of [256, "foo", true, 1n, Symbol()]) {
      expect(() => Bun.mmap(path, options)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: "MMapOptions must be an object",
        }),
      );
    }
    expect(() => Bun.mmap(path, undefined)).not.toThrow();
    expect(() => Bun.mmap(path, null)).not.toThrow();
  });

  it("mmap rejects a path that is not a string", () => {
    for (const notAPath of [undefined, null, 1, {}, [], Buffer.from(path), new URL("file://" + path)]) {
      expect(() => Bun.mmap(notAPath)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: "path must be a string" }),
      );
    }
    // The path is looked at first.
    expect(() => Bun.mmap(1, 1)).toThrow("path must be a string");
  });

  it("mmap rejects a path with a null byte, as Bun.file and node:fs do", () => {
    for (const withNull of [path + "\0", path + "\0x", "\0", "\0" + path]) {
      const expected = expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
        message: `The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received ${JSON.stringify(withNull)}`,
      });
      expect(() => Bun.mmap(withNull)).toThrow(expected);
      expect(() => Bun.file(withNull)).toThrow(expected);
    }
  });

  it("mmap takes offset and size as a BigInt too", () => {
    const text = options => Buffer.from(Bun.mmap(path, options)).toString();
    const whole = text();
    expect(text({ size: 2n })).toBe(whole.slice(0, 2));
    expect(text({ size: Object(2n) })).toBe(whole.slice(0, 2));
    expect(text({ size: { valueOf: () => 2n } })).toBe(whole.slice(0, 2));
    expect(text({ offset: 1n })).toBe(whole.slice(1));
    expect(text({ offset: 1n, size: 2n })).toBe(whole.slice(1, 3));
    expect(text({ offset: 0n, size: statSync(path, { bigint: true }).size })).toBe(whole);
    // More than the file holds is all of it: nothing wraps.
    for (const size of [2n ** 32n + 2n, 2n ** 63n, 2n ** 64n + 2n, 10n ** 400n]) expect(text({ size })).toBe(whole);
    for (const offset of [2n ** 32n + 1n, 2n ** 64n + 1n]) expect(() => Bun.mmap(path, { offset })).toThrow("EINVAL");
    expect(() => Bun.mmap(path, { size: 0n })).toThrow("EINVAL");
    for (const member of ["size", "offset"]) {
      for (const value of [-1n, -(2n ** 64n) + 1n]) {
        expect(() => Bun.mmap(path, { [member]: value })).toThrow(`${member} must be a non-negative integer`);
      }
    }
  });

  it("mmap converts offset and size to numbers and drops the fraction", () => {
    const text = options => Buffer.from(Bun.mmap(path, options)).toString();
    const whole = text();
    expect(text({ size: 2 })).toBe(whole.slice(0, 2));
    expect(text({ size: 2.9 })).toBe(whole.slice(0, 2));
    expect(text({ size: "2" })).toBe(whole.slice(0, 2));
    expect(text({ size: { valueOf: () => 2 } })).toBe(whole.slice(0, 2));
    expect(text({ offset: 1.9 })).toBe(whole.slice(1));
    expect(text({ offset: -0.9 })).toBe(whole);
    expect(text({ offset: NaN })).toBe(whole);
    expect(text({ offset: {} })).toBe(whole);
    expect(text({ size: "4294967298" })).toBe(whole);
    expect(() => Bun.mmap(path, { offset: "4294967297" })).toThrow("EINVAL");
    // More than the file holds is all of it.
    expect(text({ size: 2 ** 53 })).toBe(whole);
    expect(text({ size: 2 ** 64 })).toBe(whole);
    expect(text({ size: Infinity })).toBe(whole);
    expect(() => Bun.mmap(path, { size: NaN })).toThrow("EINVAL");
    expect(() => Bun.mmap(path, { offset: Infinity })).toThrow("EINVAL");
    expect(() => Bun.mmap(path, { offset: -Infinity })).toThrow("offset must be a non-negative integer");
    for (const member of ["size", "offset"]) {
      expect(() => Bun.mmap(path, { [member]: Symbol() })).toThrow(
        expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a number" }),
      );
    }
  });

  it("mmap reads its options in order, each once, and not from Object.prototype", () => {
    const log = [];
    const options = {};
    for (const [member, value] of Object.entries({ offset: 0, size: 2, sync: false, shared: true })) {
      Object.defineProperty(options, member, {
        get() {
          log.push(member);
          return value;
        },
      });
    }
    expect(Bun.mmap(path, options).length).toBe(2);
    expect(log).toEqual(["shared", "sync", "size", "offset"]);

    expect(Bun.mmap(path, Object.create({ size: 2 })).length).toBe(2);
    expect(Bun.mmap(path, Object.assign([], { size: 2 })).length).toBe(2);
    expect(
      Bun.mmap(
        path,
        Object.assign(() => {}, { size: 2 }),
      ).length,
    ).toBe(2);
    Object.prototype.size = 2;
    try {
      expect(Bun.mmap(path, {}).length).toBe(Bun.mmap(path).length);
    } finally {
      delete Object.prototype.size;
    }
  });

  it("mmap handles non-number offset/size without crashing", () => {
    // These should not crash - non-number values coerce to 0 per JavaScript semantics
    // Previously these caused assertion failures (issue ENG-22413)

    // null coerces to 0, which is valid for offset
    expect(() => {
      Bun.mmap(path, { offset: null });
    }).not.toThrow();

    // size: null coerces to 0, which is invalid (EINVAL), but shouldn't crash
    expect(() => {
      Bun.mmap(path, { size: null });
    }).toThrow("EINVAL");

    // undefined is ignored (property not set)
    expect(() => {
      Bun.mmap(path, { offset: undefined });
    }).not.toThrow();
  });
});
