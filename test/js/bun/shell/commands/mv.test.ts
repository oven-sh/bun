import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, isRoot, isWindows, makeTreeSync, tempDir } from "harness";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { createTestBuilder } from "../test_builder";
import { sortedShellOutput } from "../util";
const TestBuilder = createTestBuilder(import.meta.path);

$.nothrow();

describe("mv", async () => {
  TestBuilder.command`echo foo > a; mv a b`.ensureTempDir().fileEquals("b", "foo\n").runAsTest("move file -> file");

  TestBuilder.command`touch a; mkdir foo; mv a foo; ls foo`
    .ensureTempDir()
    .stdout("a\n")
    .doesNotExist("a")
    .runAsTest("move single file into a directory");

  TestBuilder.command`mkdir d; mv a b c d/; ls d/`
    .stdout(str => expect(sortedShellOutput(str)).toEqual(["a", "b", "c"]))
    .ensureTempDir()
    .file("a", "file")
    .file("b", "file")
    .file("c", "file")
    .doesNotExist("a")
    .doesNotExist("b")
    .doesNotExist("c")
    .runAsTest("move multiple files into a directory");

  TestBuilder.command`mv file1.txt file2.txt does_not_exist/`
    .exitCode(1)
    .stderr("mv: does_not_exist/: No such file or directory\n")
    .ensureTempDir()
    .file("file1.txt", "hi")
    .file("file1.txt", "hello")
    .runAsTest("fails if destination folder does not exist");

  TestBuilder.command`mkdir -p foo; mkdir -p bar; echo hi > foo/inside_foo; echo hi > bar/inside_bar; mv foo bar; ls -R bar`
    .ensureTempDir()
    .stdout(str =>
      expect(sortedShellOutput(str)).toEqual(
        sortedShellOutput(["inside_bar", "foo", join("bar", "foo") + ":", "inside_foo"]),
      ),
    )
    .runAsTest("move dir -> dir");

  TestBuilder.command`touch a; mkdir -p foo; mv foo/ a`
    .ensureTempDir()
    .exitCode(20 /* ENOTDIR */)
    .stderr("mv: a: Not a directory\n")
    .runAsTest("move dir -> file fails");

  test("-n does not overwrite an existing destination", async () => {
    using dir = tempDir("mv-n", { a: "new a", b: "new b", c: "new c", dst: "old", d: { a: "old a" } });
    const read = (name: string) => readFileSync(join(String(dir), name), "utf8");
    const mv = async (args: string) => {
      const { exitCode, stdout, stderr } = await $`mv ${{ raw: args }}`.cwd(String(dir)).quiet();
      return { exitCode, output: stdout.toString() + stderr.toString() };
    };
    const silent = { exitCode: 0, output: "" };

    expect(await mv("-n a dst")).toEqual(silent);
    expect(await mv("-f -n a dst")).toEqual(silent);
    expect({ a: read("a"), dst: read("dst") }).toEqual({ a: "new a", dst: "old" });

    // `d/a` exists, `d/b` does not.
    expect(await mv("-n a b d")).toEqual(silent);
    expect({ a: read("a"), "d/a": read("d/a"), "d/b": read("d/b") }).toEqual({
      a: "new a",
      "d/a": "old a",
      "d/b": "new b",
    });
    expect(existsSync(join(String(dir), "b"))).toBe(false);

    expect((await mv("-n missing dst")).exitCode).not.toBe(0);

    expect(await mv("-n c fresh")).toEqual(silent);
    expect(read("fresh")).toBe("new c");

    // The last of -n and -f wins.
    expect(await mv("-n -f a dst")).toEqual(silent);
    expect(read("dst")).toBe("new a");
  });

  const numbered = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);
  const silent = { stdout: "", stderr: "", exitCode: 0 };

  // 13 pairs of sources that have one name: `a0/x0` then `b0/x0`, `a1/x1` then `b1/x1`, and so on.
  const pairs = numbered("", 13);
  const sameName = pairs.flatMap(k => [`a${k}/x${k}`, `b${k}/x${k}`]);
  const sameNameFiles = Object.fromEntries(sameName.map(path => [path, path]));
  const mvSameName = async (src: string, dst: string, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await $`mv ${[...flags, ...sameName]} ${dst}`.cwd(src).quiet();
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode,
      moved: Object.fromEntries(readdirSync(dst).map(name => [name, readFileSync(join(dst, name), "utf8")])),
      left: sameName.filter(path => existsSync(join(src, path))),
    };
  };
  // As in POSIX: a source replaces the file that an earlier source put at its destination.
  const laterOfEachPair = {
    ...silent,
    moved: Object.fromEntries(pairs.map(k => [`x${k}`, `b${k}/x${k}`])),
    left: [],
  };
  const earlierOfEachPair = {
    ...silent,
    moved: Object.fromEntries(pairs.map(k => [`x${k}`, `a${k}/x${k}`])),
    left: pairs.map(k => `b${k}/x${k}`),
  };

  // Long lists, so that a `mv` that moves its sources on more than one thread fails in every run.
  describe("moves the sources in the order of the operands", () => {
    // `n0/n1/.../n25`, then `n0/n1/.../n24`, down to `n0`: each source is the directory that held the one before it.
    const nested = numbered("n", 26);
    const innermostFirst = nested.map((_, depth) => nested.slice(0, depth + 1).join("/")).reverse();
    const nestedFiles = { out: {}, [innermostFirst[0]]: {} };
    const tree = (dir: string) =>
      (readdirSync(dir, { recursive: true }) as string[]).map(path => path.replaceAll("\\", "/")).sort();
    const flattened = ["out", ...nested.map(name => `out/${name}`)].sort();

    test("a source can be the directory that held the source before it", async () => {
      using dir = tempDir("mv-order-nested", nestedFiles);
      const { stdout, stderr, exitCode } = await $`mv ${innermostFirst} out`.cwd(String(dir)).quiet();
      expect({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode, tree: tree(String(dir)) }).toEqual({
        ...silent,
        tree: flattened,
      });
    });

    test("a source can be the directory that held the source before it, in `bun exec`", async () => {
      using dir = tempDir("mv-order-nested-exec", nestedFiles);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "exec", `mv ${innermostFirst.join(" ")} out`],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, tree: tree(String(dir)) }).toEqual({ ...silent, tree: flattened });
    });

    test("the later source of one name replaces the earlier one", async () => {
      using dir = tempDir("mv-order-replace", { out: {}, ...sameNameFiles });
      expect(await mvSameName(String(dir), join(String(dir), "out"))).toEqual(laterOfEachPair);
    });

    test("-n keeps the earlier source of one name and leaves the later one in place", async () => {
      using dir = tempDir("mv-order-keep", { out: {}, ...sameNameFiles });
      expect(await mvSameName(String(dir), join(String(dir), "out"), "-n")).toEqual(earlierOfEachPair);
    });
  });

  // POSIX: after a source that fails, `mv` goes on to any remaining sources.
  describe("moves every source it can and reports each source it cannot", () => {
    const mv = async (sources: string[], existing: string[]) => {
      using dir = tempDir("mv-sources", { dest: {}, ...Object.fromEntries(existing.map(name => [name, name])) });
      const { exitCode, stdout, stderr } = await $`mv ${sources} dest`.cwd(String(dir)).quiet();
      return {
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        moved: readdirSync(join(String(dir), "dest")).sort(),
        left: readdirSync(String(dir)).sort(),
      };
    };
    const line = (name: string, message: string) => `mv: ${join("dest", name)}: ${message}\n`;
    const missing = (name: string) => line(name, "No such file or directory");
    const many = numbered("s", 11);

    test("a source that does not exist", async () => {
      const failed = { exitCode: 2 /* ENOENT */, stdout: "", left: ["dest"] };
      expect(await mv(["missing", "a"], ["a"])).toEqual({ ...failed, stderr: missing("missing"), moved: ["a"] });
      expect(await mv(["a", "missing", "b"], ["a", "b"])).toEqual({
        ...failed,
        stderr: missing("missing"),
        moved: ["a", "b"],
      });
      expect(await mv(["m1", ...many, "m2"], many)).toEqual({
        ...failed,
        // In the order of the operands.
        stderr: missing("m1") + missing("m2"),
        moved: many.toSorted(),
      });
    });

    // Windows reports these two failures with other error codes.
    test.skipIf(!isPosix)("the first source that fails gives the exit code", async () => {
      // `f` is a file, so `f/x` fails with ENOTDIR.
      const notADirectory = line("x", "Not a directory");
      const one = { stdout: "", moved: ["a"], left: ["dest", "f"] };
      expect(await mv(["missing", "f/x", "a"], ["a", "f"])).toEqual({
        ...one,
        exitCode: 2 /* ENOENT */,
        stderr: missing("missing") + notADirectory,
      });
      expect(await mv(["f/x", "missing", "a"], ["a", "f"])).toEqual({
        ...one,
        exitCode: 20 /* ENOTDIR */,
        stderr: notADirectory + missing("missing"),
      });

      const all = { stdout: "", moved: many.toSorted(), left: ["dest", "f"] };
      expect(await mv(["missing", ...many, "f/x"], [...many, "f"])).toEqual({
        ...all,
        exitCode: 2 /* ENOENT */,
        stderr: missing("missing") + notADirectory,
      });
      expect(await mv(["f/x", ...many, "missing"], [...many, "f"])).toEqual({
        ...all,
        exitCode: 20 /* ENOTDIR */,
        stderr: notADirectory + missing("missing"),
      });
    });

    // `mv * dest` has `dest` among its sources.
    test.skipIf(!isPosix)("the target among the sources", async () => {
      const intoItself = line("dest", "Invalid argument");
      const rest = { stdout: "", moved: ["a", "b"], left: ["dest"] };
      expect(await mv(["dest", "a", "missing", "b"], ["a", "b"])).toEqual({
        ...rest,
        exitCode: 22 /* EINVAL */,
        stderr: intoItself + missing("missing"),
      });
      expect(await mv(["missing", "a", "dest", "b"], ["a", "b"])).toEqual({
        ...rest,
        exitCode: 2 /* ENOENT */,
        stderr: missing("missing") + intoItself,
      });
    });
  });

  test("fails when a source name is longer than the path buffers", async () => {
    const segment = Buffer.alloc(240, "d").toString();
    const deep = join(segment, segment);
    using dir = tempDir("mv-long-source", { "target": {}, [segment]: { [segment]: {} } });
    // Longer than PATH_MAX on every POSIX platform.
    const overPathMax = Buffer.alloc(5000, "a").toString();
    // Shorter than the Linux path buffer, but `deep/` + this name overflows the 4096-byte join buffer.
    const overJoinBuffer = Buffer.alloc(3700, "b").toString();

    const fixture = /* ts */ `
      import { $ } from "bun";
      $.nothrow();
      const { OVER_PATH_MAX, OVER_JOIN_BUFFER, DEEP } = process.env;
      const run = async (...args: string[]) => {
        const { exitCode, stderr } = await $\`mv \${args}\`.quiet();
        return { failed: exitCode !== 0, stderr: stderr.toString() };
      };
      console.log(
        JSON.stringify({
          intoDir: await run(OVER_PATH_MAX!, "target"),
          intoDeepDir: await run(OVER_JOIN_BUFFER!, DEEP!),
        }),
      );
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, OVER_PATH_MAX: overPathMax, OVER_JOIN_BUFFER: overJoinBuffer, DEEP: deep },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");

    // Windows reports a different errno for a name that's too long.
    const tooLong = (path: string) =>
      isWindows ? expect.stringMatching(/^mv: /) : `mv: ${path}: File name too long\n`;
    expect(JSON.parse(stdout)).toEqual({
      intoDir: { failed: true, stderr: tooLong(`target/${overPathMax}`) },
      intoDeepDir: { failed: true, stderr: tooLong(`${deep}/${overJoinBuffer}`) },
    });
    expect(exitCode).toBe(0);
  });

  // POSIX `mv` must fall back to copy+unlink when `rename()` returns EXDEV
  // (source and destination on different filesystems). Requires a writable
  // mount on a different device from the harness temp dir.
  describe("cross-device (EXDEV)", () => {
    const tmp = tmpdir();
    function findCrossDeviceDir(): string | undefined {
      if (!isPosix) return undefined;
      const refDev = statSync(tmp).dev;
      for (const candidate of ["/dev/shm", "/tmp"]) {
        try {
          if (statSync(candidate).dev === refDev) continue;
          accessSync(candidate, constants.W_OK | constants.X_OK);
          return candidate;
        } catch {}
      }
      return undefined;
    }
    const other = findCrossDeviceDir();
    const skip = other === undefined;

    function crossDevicePair(name: string): [src: string, dst: string] {
      const base = `bun-mv-xdev-${process.pid}-${name}`;
      const a = join(tmp, base);
      const b = join(other!, base);
      for (const d of [a, b]) {
        rmSync(d, { recursive: true, force: true });
        mkdirSync(d, { recursive: true });
      }
      return [a, b];
    }

    test.skipIf(skip)("file -> file across devices", async () => {
      const [src, dst] = crossDevicePair("file");
      try {
        const srcFile = join(src, "f.txt");
        const dstFile = join(dst, "f.txt");
        writeFileSync(srcFile, "payload\n");
        chmodSync(srcFile, 0o640);

        const r = await $`mv ${srcFile} ${dstFile}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcFile)).toBe(false);
        expect(readFileSync(dstFile, "utf8")).toBe("payload\n");
        expect(statSync(dstFile).mode & 0o777).toBe(0o640);
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("file -> directory across devices", async () => {
      const [src, dst] = crossDevicePair("into-dir");
      try {
        const srcFile = join(src, "g.txt");
        writeFileSync(srcFile, "into-dir\n");

        const r = await $`mv ${srcFile} ${dst}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcFile)).toBe(false);
        expect(readFileSync(join(dst, "g.txt"), "utf8")).toBe("into-dir\n");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("symlink across devices", async () => {
      const [src, dst] = crossDevicePair("symlink");
      try {
        const srcLink = join(src, "link");
        symlinkSync("does-not-exist", srcLink);

        const r = await $`mv ${srcLink} ${dst}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(lstatSync(srcLink, { throwIfNoEntry: false })).toBeUndefined();
        expect(readlinkSync(join(dst, "link"))).toBe("does-not-exist");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("directory tree across devices", async () => {
      const [src, dst] = crossDevicePair("tree");
      try {
        const srcDir = join(src, "tree");
        mkdirSync(join(srcDir, "sub"), { recursive: true });
        writeFileSync(join(srcDir, "a.txt"), "A\n");
        writeFileSync(join(srcDir, "sub", "b.txt"), "B\n");

        const r = await $`mv ${srcDir} ${dst}`.quiet();
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        expect(existsSync(srcDir)).toBe(false);
        expect(readFileSync(join(dst, "tree", "a.txt"), "utf8")).toBe("A\n");
        expect(readFileSync(join(dst, "tree", "sub", "b.txt"), "utf8")).toBe("B\n");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("directory onto non-empty directory across devices fails", async () => {
      const [src, dst] = crossDevicePair("notempty");
      try {
        const srcDir = join(src, "d");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "f.txt"), "new\n");
        mkdirSync(join(dst, "d"));
        writeFileSync(join(dst, "d", "f.txt"), "precious\n");

        const r = await $`mv ${srcDir} ${dst}`.quiet();
        expect(r.stderr.toString()).toContain("not empty");
        expect(r.exitCode).not.toBe(0);
        expect(readFileSync(join(dst, "d", "f.txt"), "utf8")).toBe("precious\n");
        expect(readFileSync(join(srcDir, "f.txt"), "utf8")).toBe("new\n");
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip || isRoot)(
      "unreadable directory across devices fails without creating the destination",
      async () => {
        const [src, dst] = crossDevicePair("unreadable");
        const srcDir = join(src, "tree");
        try {
          mkdirSync(srcDir);
          writeFileSync(join(srcDir, "a.txt"), "A\n");
          chmodSync(srcDir, 0o000);

          const r = await $`mv ${srcDir} ${dst}`.quiet();
          expect(r.stderr.toString()).toBe(`mv: ${join(dst, "tree")}: Permission denied\n`);
          expect(lstatSync(join(dst, "tree"), { throwIfNoEntry: false })).toBeUndefined();
          chmodSync(srcDir, 0o700);
          expect(readFileSync(join(srcDir, "a.txt"), "utf8")).toBe("A\n");
          expect(r.exitCode).toBe(13);
        } finally {
          if (existsSync(srcDir)) chmodSync(srcDir, 0o700);
          rmSync(src, { recursive: true, force: true });
          rmSync(dst, { recursive: true, force: true });
        }
      },
    );

    test.skipIf(skip)("FIFO across devices fails fast", async () => {
      const [src, dst] = crossDevicePair("fifo");
      try {
        const fifo = join(src, "pipe");
        const { exitCode: mk } = Bun.spawnSync({ cmd: ["mkfifo", fifo] });
        expect(mk).toBe(0);

        const r = await $`mv ${fifo} ${dst}`.quiet();
        expect(r.stderr.toString()).toContain("not supported");
        expect(r.exitCode).not.toBe(0);
        expect(lstatSync(fifo).isFIFO()).toBe(true);
        expect(lstatSync(join(dst, "pipe"), { throwIfNoEntry: false })).toBeUndefined();
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    // Two copies onto one destination at the same time can leave a file that is neither source.
    test.skipIf(skip)("the later source of one name replaces the earlier one across devices", async () => {
      const [src, dst] = crossDevicePair("same-name");
      try {
        makeTreeSync(src, sameNameFiles);
        expect(await mvSameName(src, dst)).toEqual(laterOfEachPair);
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("-n keeps the earlier source of one name across devices", async () => {
      const [src, dst] = crossDevicePair("same-name-n");
      try {
        makeTreeSync(src, sameNameFiles);
        expect(await mvSameName(src, dst, "-n")).toEqual(earlierOfEachPair);
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    test.skipIf(skip)("a source that fails does not stop the later ones across devices", async () => {
      const [src, dst] = crossDevicePair("go-on");
      try {
        const copied = numbered("s", 8);
        for (const name of [...copied, "f"]) writeFileSync(join(src, name), name);

        // `f` is a file, so `f/x` fails in another way than `missing`.
        const r = await $`mv missing ${copied} f/x ${dst}`.cwd(src).quiet();
        expect({
          stderr: r.stderr.toString(),
          exitCode: r.exitCode,
          moved: readdirSync(dst).sort(),
          left: readdirSync(src),
        }).toEqual({
          stderr: `mv: ${join(dst, "missing")}: No such file or directory\nmv: ${join(dst, "x")}: Not a directory\n`,
          exitCode: 2 /* ENOENT */,
          moved: copied,
          left: ["f"],
        });
      } finally {
        rmSync(src, { recursive: true, force: true });
        rmSync(dst, { recursive: true, force: true });
      }
    });

    // The fixture creates its mounts in a private mount namespace, either as root or in a user namespace.
    function findUnshare(): string[] | undefined {
      const unshare = isLinux ? Bun.which("unshare") : null;
      if (!unshare) return undefined;
      using probe = tempDir("mv-unshare-probe", { a: {}, b: {} });
      const mounts = 'mount -t tmpfs -o size=1m tmpfs "$1" && mount --bind "$1" "$2"';
      for (const namespaces of ["-Urm", "-m"]) {
        const cmd = [unshare, namespaces, "--propagation", "private"];
        const { exitCode } = Bun.spawnSync({
          cmd: [...cmd, "sh", "-c", mounts, "sh", join(String(probe), "a"), join(String(probe), "b")],
          stdout: "ignore",
          stderr: "ignore",
        });
        if (exitCode === 0) return cmd;
      }
      return undefined;
    }
    const unshare = findUnshare();

    // rename(2) only rejects moving a directory into itself when both paths are on the same mount.
    test.skipIf(!unshare)("doesn't copy a directory into itself across mounts", async () => {
      using dir = tempDir("mv-with-mounts", {});
      await using proc = Bun.spawn({
        cmd: [...unshare!, bunExe(), join(import.meta.dir, "mv-into-itself-fixture.ts"), String(dir)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(
        Object.fromEntries(
          stdout
            .split("\n")
            .filter(Boolean)
            .map(line => JSON.parse(line)),
        ),
      ).toEqual({
        mountPointOperand: { stderr: "mv: out/out: Invalid argument\n", tree: ["out", "out/f1", "out/f2"] },
        mountInsideNewPath: { stderr: "mv: a/sub: Invalid argument\n", tree: ["sub", "sub/mnt", "sub/top"] },
        mountOfChild: { stderr: "mv: b/sub: Invalid argument\n" },
        betweenTwoMounts: { stderr: "", tree: ["x", "x/sub", "x/sub/deep", "x/sub/deep/file", "x/sub/file"] },
      });
      expect(exitCode).toBe(0);
    });
  });
});
