import { describe, expect, it, test } from "bun:test";
import fs, { mkdirSync } from "fs";
import {
  bunEnv,
  bunExe,
  exampleHtml,
  exampleSite,
  gcTick,
  isASAN,
  isLinux,
  isWindows,
  tempDir,
  withoutAggressiveGC,
} from "harness";
import { mkfifo } from "mkfifo";
import { once } from "node:events";
import http from "node:http";
import path, { join } from "path";

let i = 0;
const IS_UV_FS_COPYFILE_DISABLED =
  process.platform === "win32" && process.env.BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE === "1";

(isWindows ? describe : describe.concurrent)("Bun.write", () => {
  process.platform === "win32" && process.env.BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE === "1";

  it("Bun.write blob", async () => {
    using tmpbase = tempDir("bun-write-blob", {});
    await Bun.write(
      Bun.file(join(tmpbase, "response-file.test.txt")),
      Bun.file(path.resolve(import.meta.dir, "fetch.js.txt")),
    );
    await gcTick();
    await Bun.write(Bun.file(join(tmpbase, "response-file.test.txt")), "blah blah blha");
    await gcTick();
    await Bun.write(Bun.file(join(tmpbase, "response-file.test.txt")), new Uint32Array(1024));
    await gcTick();
    await Bun.write(join(tmpbase, "response-file.test.txt"), new Uint32Array(1024));
    await gcTick();
    expect(await Bun.write(new TextEncoder().encode(tmpbase + "response-file.test.txt"), new Uint32Array(1024))).toBe(
      new Uint32Array(1024).byteLength,
    );
    await gcTick();
  });

  describe("large file", () => {
    it("write large file (text)", async () => {
      using tmpbase = tempDir("large-file-text", {});
      const filename = tmpbase + `bun-test-large-file-${Date.now()}.txt`;
      const content = "https://www.iana.org/assignments/media-types/media-types.xhtml,".repeat(10000);

      try {
        unlinkSync(filename);
      } catch (e) {}
      await Bun.write(filename, content);
      expect(await Bun.file(filename).text()).toBe(content);

      try {
        unlinkSync(filename);
      } catch (e) {}
    });

    it("write large file (bytes)", async () => {
      using tmpbase = tempDir("large-file-bytes", {});
      const filename = tmpbase + `bun-test-large-file-${Date.now()}.txt`;
      const content = "https://www.iana.org/assignments/media-types/media-types.xhtml,".repeat(10000);

      try {
        unlinkSync(filename + ".bytes");
      } catch (e) {}
      var bytes = new TextEncoder().encode(content);
      const written = await Bun.write(filename + ".bytes", bytes);
      expect(written).toBe(bytes.byteLength);
      expect(new Buffer(await Bun.file(filename + ".bytes").arrayBuffer()).equals(bytes)).toBe(true);

      try {
        unlinkSync(filename + ".bytes");
      } catch (e) {}
    });

    it("write large file (Blob)", async () => {
      using tmpbase = tempDir("large-file-blob", {});
      const filename = tmpbase + `bun-test-large-file-${Date.now()}.txt`;
      const content = "https://www.iana.org/assignments/media-types/media-types.xhtml,".repeat(10000);

      try {
        unlinkSync(filename + ".blob");
      } catch (e) {}
      var bytes = new Blob([content]);
      await Bun.write(filename + ".blob", bytes);
      expect(await Bun.file(filename + ".blob").text()).toBe(content);

      try {
        unlinkSync(filename + ".blob");
      } catch (e) {}
    });
  });

  it("Bun.file not found returns ENOENT", async () => {
    try {
      await gcTick();
      await Bun.file(join("does", "not", "exist.txt")).text();
      await gcTick();
    } catch (exception) {
      expect(exception.code).toBe("ENOENT");
    }
    await gcTick();
  });

  it("Bun.write file not found returns ENOENT, issue#6336", async () => {
    using tmpbase = tempDir("bun-write-enoent", {});
    const dst = Bun.file(path.join(tmpbase, join("does", "not", "exist.txt")));
    fs.rmSync(join(tmpbase, "does"), { force: true, recursive: true });

    try {
      await gcTick();
      await Bun.write(dst, "", { createPath: false });
      await gcTick();
      expect.unreachable();
    } catch (exception) {
      expect(exception.code).toBe("ENOENT");
      if (!IS_UV_FS_COPYFILE_DISABLED) {
        expect(exception.path).toBe(dst.name);
      }
    }

    const src = Bun.file(path.join(tmpbase, `test-bun-write-${Date.now()}.txt`));

    await Bun.write(src, "");
    try {
      await gcTick();
      await Bun.write(dst, src, { createPath: false });
      await gcTick();
    } catch (exception) {
      expect(exception.code).toBe("ENOENT");
      if (!IS_UV_FS_COPYFILE_DISABLED) {
        expect(exception.path).toBe(dst.name);
      }
    } finally {
      fs.unlinkSync(src.name);
    }
  });

  describe.each(["plain-ascii-missing.txt", "surro-\ud800-gate.txt"])(
    "Bun.write(dest, Bun.file(missing source)) rejects with ENOENT (%s)",
    basename => {
      it("rejects instead of crashing", async () => {
        using dir = tempDir("bun-write-missing-src", {});
        const fixture = `
          const { join } = require("path");
          const dir = ${JSON.stringify(String(dir))};
          const src = Bun.file(join(dir, ${JSON.stringify(basename)}));
          try {
            await Bun.write(join(dir, "dest.txt"), src);
            console.log("UNEXPECTED: write resolved");
          } catch (e) {
            console.log("CODE=" + e.code);
            console.log("PATH_IS_SRC=" + (e.path === src.name));
          }
        `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", fixture],
          env: bunEnv,
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toContain("CODE=ENOENT");
        if (isWindows && !IS_UV_FS_COPYFILE_DISABLED) {
          expect(stdout).toContain("PATH_IS_SRC=true");
        }
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });

      it("with destination directory that does not exist", async () => {
        using dir = tempDir("bun-write-missing-src-dest", {});
        const fixture = `
          const { join } = require("path");
          const dir = ${JSON.stringify(String(dir))};
          const src = Bun.file(join(dir, ${JSON.stringify(basename)}));
          try {
            await Bun.write(join(dir, "sub", "dir", "dest.txt"), src);
            console.log("UNEXPECTED: write resolved");
          } catch (e) {
            console.log("CODE=" + e.code);
          }
        `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", fixture],
          env: bunEnv,
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toContain("CODE=ENOENT");
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      });
    },
  );

  it("Bun.write(dest, Bun.file(src)) creates missing destination directory", async () => {
    using dir = tempDir("bun-write-mkdirp-dest", {
      "src.txt": "copy me",
    });
    const fixture = `
      const { join } = require("path");
      const dir = ${JSON.stringify(String(dir))};
      const dest = join(dir, "a", "b", "dest.txt");
      await Bun.write(dest, Bun.file(join(dir, "src.txt")));
      console.log(await Bun.file(dest).text());
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("copy me");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("Bun.write('out.txt', 'string')", async () => {
    using tmpbase = tempDir("bun-write-string", {});
    const outpath = path.join(tmpbase, "out." + ((Math.random() * 102400) | 0).toString(32) + "txt");
    for (let erase of [true, false]) {
      if (erase) {
        try {
          fs.unlinkSync(outpath);
        } catch (e) {}
      }
      await gcTick();
      expect(await Bun.write(outpath, "string")).toBe("string".length);
      await gcTick();
      const out = Bun.file(outpath);
      await gcTick();
      expect(await out.text()).toBe("string");
      await gcTick();
      expect(await out.text()).toBe(fs.readFileSync(outpath, "utf8"));
      await gcTick();
    }
  });

  it("Bun.file -> Bun.file", async () => {
    using tmpbase = tempDir("bun-file-to-file", {});
    try {
      fs.unlinkSync(path.join(tmpbase, "fetch.js.in"));
    } catch (e) {}
    await gcTick();
    try {
      fs.unlinkSync(path.join(tmpbase, "fetch.js.out"));
    } catch (e) {}
    await gcTick();

    fs.writeFileSync(tmpbase + "fetch.js.in", exampleHtml);
    await gcTick();
    {
      const result = await Bun.write(Bun.file(tmpbase + "fetch.js.out"), Bun.file(tmpbase + "fetch.js.in"));
      await gcTick();
      expect(await Bun.file(tmpbase + "fetch.js.out").text()).toBe(exampleHtml);
      await gcTick();
    }

    {
      await Bun.write(
        Bun.file(tmpbase + "fetch.js.in").slice(0, (exampleHtml.length / 2) | 0),
        Bun.file(tmpbase + "fetch.js.out"),
      );
      expect(await Bun.file(tmpbase + "fetch.js.in").text()).toBe(
        exampleHtml.substring(0, (exampleHtml.length / 2) | 0),
      );
    }

    {
      await gcTick();
      await Bun.write(tmpbase + "fetch.js.in", Bun.file(tmpbase + "fetch.js.out"));
      await gcTick();
      expect(await Bun.file(tmpbase + "fetch.js.in").text()).toBe(exampleHtml);
    }
  });

  it("Bun.file", async () => {
    const file = path.join(import.meta.dir, "fetch.js.txt");
    await gcTick();
    expect(await Bun.file(file).text()).toBe(fs.readFileSync(file, "utf8"));
    await gcTick();
  });

  it("Bun.file empty file", async () => {
    const file = path.join(import.meta.dir, "emptyFile");
    await gcTick();
    const buffer = await Bun.file(file).arrayBuffer();
    expect(buffer.byteLength).toBe(0);
    await gcTick();
  });

  it("Bun.file lastModified update", async () => {
    using tmpbase = tempDir("bun-file-lastmodified", {});
    const file = Bun.file(tmpbase + "/bun.test.lastModified.txt");
    await gcTick();
    // setup
    await Bun.write(file, "test text.");
    const lastModified0 = file.lastModified;

    // sleep some time and write the file again.
    await Bun.sleep(isWindows ? 1000 : 100);
    await Bun.write(file, "test text2.");
    const lastModified1 = file.lastModified;

    // ensure the last modified timestamp is updated.
    expect(lastModified1).toBeGreaterThan(lastModified0);
    await gcTick();
  });

  it("Bun.file as a Blob", async () => {
    const filePath = path.join(import.meta.path, "../fetch.js.txt");
    const fixture = fs.readFileSync(filePath, "utf8");
    // this is a Blob object with the same interface as the one returned by fetch
    // internally, instead of a byte array, it stores the file path!
    // this enables several performance optimizations
    var blob = Bun.file(filePath);
    await gcTick();

    // now it reads "./fetch.js.txt" from the filesystem
    // it's lazy, only loads once we ask for it
    // if it fails, the promise will reject at this point
    expect(await blob.text()).toBe(fixture);
    await gcTick();
    // BEHAVIOR CHANGE IN BUN V0.3.0 - size is never set
    // now that it's loaded, the size updates
    // expect(blob.size).toBe(fixture.length);
    // await gcTick();
    // and it only loads once for _all_ blobs pointing to that file path
    // until all references are released
    expect((await blob.arrayBuffer()).byteLength).toBe(fixture.length);
    await gcTick();

    const array = new Uint8Array(await blob.arrayBuffer());
    await gcTick();
    const text = fixture;
    withoutAggressiveGC(() => {
      for (let i = 0; i < text.length; i++) {
        expect(array[i]).toBe(text.charCodeAt(i));
      }
    });
    await gcTick();
    expect(blob.size).toBe(fixture.length);
    blob = null;
    await gcTick();
    await new Promise(resolve => setTimeout(resolve, 1));
    var blob = Bun.file(filePath);
    expect(blob.size).toBe(fixture.length);
  });

  it("Response -> Bun.file", async () => {
    const file = path.join(import.meta.dir, "fetch.js.txt");
    await gcTick();
    const text = fs.readFileSync(file, "utf8");
    await gcTick();
    const response = new Response(Bun.file(file));

    await gcTick();
    expect(await response.text()).toBe(text);
    await gcTick();
  });

  it("Bun.file -> Response", async () => {
    using tmpbase = tempDir("bun-file-to-response", {});
    await using server = exampleSite("https");
    // ensure the file doesn't already exist
    try {
      fs.unlinkSync(tmpbase + "fetch.js.out");
    } catch {}
    await gcTick();
    await gcTick();
    const resp = await fetch(server.url, { tls: { ca: server.ca } });
    await gcTick();
    await gcTick();
    expect(await Bun.write(tmpbase + "fetch.js.out", resp)).toBe(exampleHtml.length);
    expect(await Bun.file(tmpbase + "fetch.js.out").text()).toBe(exampleHtml);
    await gcTick();
  });

  it("Response -> Bun.file -> Response -> text", async () => {
    await gcTick();
    const file = path.join(import.meta.dir, "fetch.js.txt");
    await gcTick();
    const text = fs.readFileSync(file, "utf8");
    await gcTick();
    const response = new Response(Bun.file(file));
    await gcTick();
    const response2 = response.clone();
    await gcTick();
    expect(await response2.text()).toBe(text);
    await gcTick();
  });

  it("Bun.write('output.html', '')", async () => {
    using tmpbase = tempDir("bun-write-output-html", {});
    await Bun.write(tmpbase + "output.html", "lalalala");
    expect(await Bun.write(tmpbase + "output.html", "")).toBe(0);
    await Bun.write(tmpbase + "output.html", "lalalala");
    expect(await Bun.file(tmpbase + "output.html").text()).toBe("lalalala");
  });

  it("Bun.write(Bun.stdout, 'Bun.write STDOUT TEST')", async () => {
    expect(await Bun.write(Bun.stdout, "\nBun.write STDOUT TEST\n\n")).toBe(24);
  });

  it("Bun.write(Bun.stderr, 'Bun.write STDERR TEST')", async () => {
    expect(await Bun.write(Bun.stderr, "\nBun.write STDERR TEST\n\n")).toBe(24);
  });

  it("Bun.write(Bun.stdout, new TextEncoder().encode('Bun.write STDOUT TEST'))", async () => {
    expect(await Bun.write(Bun.stdout, new TextEncoder().encode("\nBun.write STDOUT TEST\n\n"))).toBe(24);
  });

  it("Bun.write(Bun.stderr, 'new TextEncoder().encode(Bun.write STDERR TEST'))", async () => {
    expect(await Bun.write(Bun.stderr, new TextEncoder().encode("\nBun.write STDERR TEST\n\n"))).toBe(24);
  });

  // These tests pass by not throwing:
  it("Bun.write(Bun.stdout, Bun.file(path))", async () => {
    await Bun.write(Bun.stdout, Bun.file(path.join(import.meta.dir, "hello-world.txt")));
  });

  it("Bun.write(Bun.stderr, Bun.file(path))", async () => {
    await Bun.write(Bun.stderr, Bun.file(path.join(import.meta.dir, "hello-world.txt")));
  });

  // macOS fcopyfile(COPYFILE_DATA) rewrites dst from offset 0, and the
  // slice trim on macOS/FreeBSD (and the Linux read/write fallback) was
  // ftruncate(dst, N); both destroy bytes in a file the caller already had
  // open. BUN_CONFIG_DISABLE_COPY_FILE_RANGE=1 routes Linux through the
  // fallback so the assertion fail-befores on every POSIX lane.
  describe.skipIf(isWindows)("Bun.write(Bun.file(fd), Bun.file(path)) does not truncate the fd", () => {
    const fallbackEnv = { ...bunEnv, BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1" };

    it("preserves bytes past the slice window in an r+ fd", async () => {
      using dir = tempDir("bun-write-fd-slice", {
        "src.bin": Buffer.alloc(200_000, "S").toString(),
        "dst.bin": Buffer.alloc(30, "D").toString(),
      });
      const src = join(String(dir), "src.bin");
      const dst = join(String(dir), "dst.bin");
      const script = `
        const fs = require("fs");
        const fd = fs.openSync(${JSON.stringify(dst)}, "r+");
        try {
          process.stderr.write(String(await Bun.write(Bun.file(fd).slice(0, 5), Bun.file(${JSON.stringify(src)}))));
        } finally { fs.closeSync(fd); }
      `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: fallbackEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, resolved: stderr, content: fs.readFileSync(dst, "utf8") }).toEqual({
        stdout: "",
        resolved: "5",
        content: "SSSSS" + Buffer.alloc(25, "D").toString(),
      });
      expect(exitCode).toBe(0);
    });

    it("preserves pre-existing bytes when stdout is redirected with >>", async () => {
      using dir = tempDir("bun-write-stdout-append", {
        "src.bin": Buffer.alloc(1000, "S").toString(),
        "log.txt": "AAAAAAAAAA",
      });
      const src = join(String(dir), "src.bin");
      const log = join(String(dir), "log.txt");
      const script = `process.stderr.write(String(await Bun.write(Bun.stdout.slice(0, 100), Bun.file(${JSON.stringify(src)}))))`;

      await using proc = Bun.spawn({
        cmd: ["sh", "-c", `"$BUN" -e ${JSON.stringify(script)} >> ${JSON.stringify(log)}`],
        env: { ...fallbackEnv, BUN: bunExe() },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, resolved: stderr, content: fs.readFileSync(log, "utf8") }).toEqual({
        stdout: "",
        resolved: "100",
        content: "AAAAAAAAAA" + Buffer.alloc(100, "S").toString(),
      });
      expect(exitCode).toBe(0);
    });

    it("does not fallocate an O_APPEND fd for a source above the preallocate threshold", async () => {
      const size = 3_000_000;
      using dir = tempDir("bun-write-fd-preallocate", { "dst.bin": "AAAAAAAAAA" });
      const src = join(String(dir), "src.bin");
      const dst = join(String(dir), "dst.bin");
      fs.writeFileSync(src, Buffer.alloc(size, "S"));
      const script = `
        const fs = require("fs");
        const fd = fs.openSync(${JSON.stringify(dst)}, "a");
        try {
          process.stderr.write(String(await Bun.write(Bun.file(fd), Bun.file(${JSON.stringify(src)}))));
        } finally { fs.closeSync(fd); }
      `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: fallbackEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({
        stdout,
        resolved: stderr,
        head: fs.readFileSync(dst).subarray(0, 15).toString(),
        size: fs.statSync(dst).size,
      }).toEqual({
        stdout: "",
        resolved: String(size),
        head: "AAAAAAAAAASSSSS",
        size: 10 + size,
      });
      expect(exitCode).toBe(0);
    });
  });

  // fstat on a FIFO reports st_size == 0, so the kernel-copy / bounded loop
  // must terminate on EOF, not on the stat-derived budget.
  // Bun.spawn({stdin:"pipe"}) hands the child a socketpair, not a FIFO, so
  // run the pipeline under sh to get real kernel pipes on fd 0/1.
  it.skipIf(isWindows)("Bun.write(Bun.stdout, Bun.stdin) copies the whole pipe (> 4096 bytes)", async () => {
    const size = 1024 * 1024;
    const script = `process.stderr.write(String(await Bun.write(Bun.stdout, Bun.stdin)))`;

    await using proc = Bun.spawn({
      cmd: ["sh", "-c", `head -c ${size} /dev/zero | "$BUN" -e ${JSON.stringify(script)} | wc -c`],
      env: { ...bunEnv, BUN: bunExe() },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ piped: stdout.trim(), resolved: stderr.trim() }).toEqual({
      piped: String(size),
      resolved: String(size),
    });
    expect(exitCode).toBe(0);
  });

  // The destination is opened with O_CREAT | O_TRUNC, so every check that can
  // reject the source has to run before it is opened: a rejected copy must
  // leave the destination exactly as it was.
  describe("Bun.write(dest, Bun.file(unusable source)) leaves the destination alone", () => {
    const original = Buffer.alloc(16384, "Z").toString();
    const settle = promise =>
      promise.then(
        value => ({ resolved: value }),
        error => ({ rejected: error.message }),
      );

    // Windows copies through uv_fs_copyfile(), which reports a directory
    // source as a generic copyfile failure (and never touches the
    // destination); the message below is the POSIX CopyFile one.
    describe.skipIf(isWindows)("directory source", () => {
      it.each([
        { dest: "path", src: "path" },
        { dest: "Bun.file", src: "path" },
        { dest: "path", src: "fd" },
        { dest: "Bun.file", src: "fd" },
      ])("$dest destination, directory $src source", async ({ dest: destKind, src: srcKind }) => {
        using dir = tempDir("bun-write-dir-src", { "important.db": original });
        const destPath = join(String(dir), "important.db");
        const dest = destKind === "Bun.file" ? Bun.file(destPath) : destPath;
        const dirFd = srcKind === "fd" ? fs.openSync(String(dir), "r") : -1;
        try {
          const outcome = await settle(Bun.write(dest, Bun.file(srcKind === "fd" ? dirFd : String(dir))));
          expect({ outcome, content: fs.readFileSync(destPath, "utf8") }).toEqual({
            outcome: { rejected: "That doesn't work on folders" },
            content: original,
          });
        } finally {
          if (dirFd !== -1) fs.closeSync(dirFd);
        }
      });

      it("does not create a missing destination", async () => {
        using dir = tempDir("bun-write-dir-src-absent", {});
        const destPath = join(String(dir), "new.db");

        const outcome = await settle(Bun.write(destPath, Bun.file(String(dir))));

        expect({ outcome, destExists: fs.existsSync(destPath) }).toEqual({
          outcome: { rejected: "That doesn't work on folders" },
          destExists: false,
        });
      });
    });

    // Only Linux rejects a FIFO -> regular file copy (macOS falls back to a
    // read/write loop and copies it). Holding the FIFO open read/write from
    // this process gives Bun's O_RDONLY open a writer, so it returns at once.
    it.skipIf(!isLinux)("FIFO source", async () => {
      using dir = tempDir("bun-write-fifo-src", { "important.db": original });
      const destPath = join(String(dir), "important.db");
      const fifoPath = join(String(dir), "fifo");
      mkfifo(fifoPath);
      const holder = fs.openSync(fifoPath, "r+");
      try {
        const outcome = await settle(Bun.write(destPath, Bun.file(fifoPath)));
        expect({ outcome, content: fs.readFileSync(destPath, "utf8") }).toEqual({
          outcome: { rejected: "Non-regular files aren't supported yet" },
          content: original,
        });
      } finally {
        fs.closeSync(holder);
      }
    });

    // Also covers the Windows read/write fallback (this file re-runs itself
    // with BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE=1 on Windows), which used
    // to open the destination before the source.
    it("missing source", async () => {
      using dir = tempDir("bun-write-missing-src-keeps-dest", { "important.db": original });
      const destPath = join(String(dir), "important.db");

      const outcome = await Bun.write(destPath, Bun.file(join(String(dir), "missing.txt"))).then(
        value => ({ resolved: value }),
        error => ({ rejected: error.code }),
      );

      expect({ outcome, content: fs.readFileSync(destPath, "utf8") }).toEqual({
        outcome: { rejected: "ENOENT" },
        content: original,
      });
    });
  });

  it("Bun.file(0) survives GC", async () => {
    for (let i = 0; i < 10; i++) {
      let f = Bun.file(0);
      await gcTick();
      expect(Bun.inspect(f)).toContain("FileRef (fd: 0)");
    }
  });

  // FLAKY TEST
  // Since Bun.file is resolved lazily, this needs to specifically be checked
  it("Bun.write('output.html', HTMLRewriter.transform(Bun.file)))", async done => {
    using tmpbase = tempDir("html-rewriter", {});
    var rewriter = new HTMLRewriter();

    rewriter.on("div", {
      element(element) {
        element.setInnerContent("<blink>it worked!</blink>", { html: true });
      },
    });
    await Bun.write(tmpbase + "html-rewriter.txt.js", "<div>hello</div>");
    var input = new Response(Bun.file(tmpbase + "html-rewriter.txt.js"));
    var output = rewriter.transform(input);
    const outpath = tmpbase + `html-rewriter.${Date.now()}.html`;
    await Bun.write(outpath, output);
    expect(await Bun.file(outpath).text()).toBe("<div><blink>it worked!</blink></div>");
    done();
  });

  it("length should be limited by file size #5080", async () => {
    using tmpbase = tempDir("file-size-limit", {});
    const filename = tmpbase + "/bun.test.offset2.txt";
    await Bun.write(filename, "contents");
    const file = Bun.file(filename);
    const slice = file.slice(2, 1024);
    const contents = await slice.text();
    expect(contents).toBe("ntents");
    expect(contents.length).toBeLessThanOrEqual(file.size);
  });

  // it("#2674", async () => {
  //   const file = path.join(import.meta.dir, "big-stdout.js");

  //   const { stderr, stdout, exitCode } = Bun.spawnSync({
  //     cmd: [bunExe(), "run", file],
  //     env: bunEnv,
  //     stderr: "pipe",
  //     stdout: "pipe",
  //   });
  //   console.log(stderr?.toString());
  //   const text = stdout?.toString();
  //   expect(text?.length).toBe(300000);
  //   const error = stderr?.toString();
  //   expect(error?.length).toBeFalsy();
  //   expect(exitCode).toBe(0);
  // });

  if (process.platform === "linux") {
    describe("should work when copyFileRange is not available", () => {
      it("on large files", () => {
        using tmpbase = tempDir("copy-file-range-large", {});
        var tempdir = `${tmpbase}/fs.test.js/${Date.now()}-1/bun-write/large`;
        expect(fs.existsSync(tempdir)).toBe(false);
        expect(tempdir.includes(mkdirSync(tempdir, { recursive: true }))).toBe(true);
        var buffer = new Int32Array(1024 * 1024 * 64);
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = i % 256;
        }

        const hash = Bun.hash(buffer.buffer);
        const src = join(tempdir, "Bun.write.src.blob");
        const dest = join(tempdir, "Bun.write.dest.blob");

        try {
          fs.writeFileSync(src, buffer.buffer);

          expect(fs.existsSync(dest)).toBe(false);

          const { exitCode } = Bun.spawnSync({
            stdio: ["inherit", "inherit", "inherit"],
            cmd: [bunExe(), join(import.meta.dir, "./bun-write-exdev-fixture.js"), src, dest],
            env: {
              ...bunEnv,
              BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1",
            },
          });
          expect(exitCode).toBe(0);

          expect(Bun.hash(fs.readFileSync(dest))).toBe(hash);
        } finally {
          fs.rmSync(src, { force: true });
          fs.rmSync(dest, { force: true });
        }
      });

      it("on small files", () => {
        using tmpbase = tempDir("copy-file-range-small", {});
        const tempdir = `${tmpbase}/fs.test.js/${Date.now()}-1/bun-write/small`;
        expect(fs.existsSync(tempdir)).toBe(false);
        expect(tempdir.includes(mkdirSync(tempdir, { recursive: true }))).toBe(true);
        var buffer = new Int32Array(1 * 1024);
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = i % 256;
        }

        const hash = Bun.hash(buffer.buffer);
        const src = join(tempdir, "Bun.write.src.blob");
        const dest = join(tempdir, "Bun.write.dest.blob");

        try {
          fs.writeFileSync(src, buffer.buffer);

          expect(fs.existsSync(dest)).toBe(false);

          const { exitCode } = Bun.spawnSync({
            stdio: ["inherit", "inherit", "inherit"],
            cmd: [bunExe(), join(import.meta.dir, "./bun-write-exdev-fixture.js"), src, dest],
            env: {
              ...bunEnv,
              BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1",
            },
          });
          expect(exitCode).toBe(0);

          expect(Bun.hash(fs.readFileSync(dest))).toBe(hash);
        } finally {
          fs.rmSync(src, { force: true });
          fs.rmSync(dest, { force: true });
        }
      });
    });

    it.skipIf(!(Bun.which("cc") || Bun.which("gcc") || Bun.which("clang")))(
      "read/write fallback hints POSIX_FADV_SEQUENTIAL on the source fd",
      async () => {
        const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
        using dir = tempDir("bun-write-fadvise", {
          "shim.c": `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <sys/types.h>
static int (*real)(int, off_t, off_t, int);
int posix_fadvise(int fd, off_t offset, off_t len, int advice) {
  if (!real) real = dlsym(RTLD_NEXT, "posix_fadvise");
  fprintf(stderr, "[fadvise] fd=%d advice=%d\\n", fd, advice);
  return real(fd, offset, len, advice);
}
`,
          "src.bin": Buffer.alloc(128 * 1024, 0x41).toString(),
        });
        const shim = join(String(dir), "shim.so");
        await using ccProc = Bun.spawn({
          cmd: [cc, "-shared", "-fPIC", "-o", shim, join(String(dir), "shim.c"), "-ldl"],
          env: bunEnv,
          stderr: "pipe",
        });
        const [ccErr, ccExit] = await Promise.all([ccProc.stderr.text(), ccProc.exited]);
        if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr}`);

        const existing = bunEnv.LD_PRELOAD;
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            join(import.meta.dir, "./bun-write-exdev-fixture.js"),
            join(String(dir), "src.bin"),
            join(String(dir), "dst.bin"),
          ],
          env: {
            ...bunEnv,
            BUN_CONFIG_DISABLE_COPY_FILE_RANGE: "1",
            LD_PRELOAD: existing ? `${shim}:${existing}` : shim,
          },
          stderr: "pipe",
          stdout: "pipe",
        });
        const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
        expect({ stderr, stdout }).toEqual({
          stderr: expect.stringMatching(/\[fadvise\] fd=\d+ advice=2/),
          stdout: "",
        });
        expect(fs.readFileSync(join(String(dir), "dst.bin"))).toEqual(Buffer.alloc(128 * 1024, 0x41));
        expect(exitCode).toBe(0);
      },
    );
  }

  describe("ENOENT", () => {
    const creates = (...opts) => {
      it("creates the directory", async () => {
        using tmpbase = tempDir("enoent-creates-dir", {});
        const dir = `${tmpbase}/fs.test.js/${Date.now()}-1/bun-write/ENOENT/${i++}`;
        const file = join(dir, "file");
        try {
          await Bun.write(file, "contents", ...opts);
          expect(fs.existsSync(file)).toBe(true);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    };

    describe("by default", () => creates());
    describe("with { createPath: true }", () => {
      creates({ createPath: true });
    });

    describe("with { createPath: false }", () => {
      it("does not create the directory", async () => {
        using tmpbase = tempDir("enoent-no-create-dir", {});
        const dir = `${tmpbase}/fs.test.js/${performance.now()}-1/bun-write/ENOENT`;
        const file = join(dir, "file");
        try {
          expect(async () => await Bun.write(file, "contents", { createPath: false })).toThrow(
            "no such file or directory",
          );
          expect(fs.existsSync(file)).toBe(false);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });

      it("throws when given a file descriptor", async () => {
        const file = Bun.file(123);
        expect(async () => await Bun.write(file, "contents", { createPath: true })).toThrow(
          "Cannot create a directory for a file descriptor",
        );
      });
    });
  });

  test("timed output should work", async () => {
    const producer_file = path.join(import.meta.dir, "timed-stderr-output.js");

    const producer = Bun.spawn([bunExe(), "run", producer_file], {
      stderr: "pipe",
      stdout: "inherit",
      stdin: "inherit",
    });

    let text = "";
    for await (const chunk of producer.stderr) {
      text += [...chunk].map(x => String.fromCharCode(x)).join("");
      await Bun.sleep(100);
    }
    expect(text).toBe("0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19\n20\n21\n22\n23\n24\n25\n");
  }, 25000);

  if (isWindows && !IS_UV_FS_COPYFILE_DISABLED) {
    it("Bun.write() without uv_fs_copyfile", async () => {
      const { exited } = Bun.spawn({
        cmd: [bunExe(), "test", import.meta.path],
        env: {
          ...bunEnv,
          BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE: "1",
        },
        stdio: ["inherit", "inherit", "inherit"],
      });

      expect(await exited).toBe(0);
    }, 10000);
  }

  it("BunFile.name survives multiple file.write() calls + GC", async () => {
    using dir = tempDir("bun-file-name-write-gc", {});
    const filePath = join(String(dir), "out.txt");

    const f = Bun.file(filePath);
    expect(f.name).toBe(filePath);

    await f.write("a");
    await f.write("b");
    await f.write("c");
    await f.write("d");
    Bun.gc(true);

    expect(f.name).toBe(filePath);
    expect(await f.text()).toBe("d");
  });

  it("BunFile.name survives multiple Bun.write() calls + GC", async () => {
    using dir = tempDir("bun-file-name-bunwrite-gc", {});
    const filePath = join(String(dir), "out.txt");

    const f = Bun.file(filePath);
    expect(f.name).toBe(filePath);

    await Bun.write(f, "a");
    await Bun.write(f, "b");
    await Bun.write(f, "c");
    await Bun.write(f, "d");
    Bun.gc(true);

    expect(f.name).toBe(filePath);
    expect(await f.text()).toBe("d");
  });

  // `resp.body` materialises the body as a native ByteStream; once the
  // transfer finishes the FetchTasklet is freed, but the body's PendingValue
  // kept `task` / `on_start_buffering` pointing at the freed tasklet, and
  // `Bun.write(path, resp)` then called `on_start_buffering(task)`.
  it.skipIf(!isASAN).each([
    ["getReader().read() then releaseLock()", "const rd = resp.body.getReader(); await rd.read(); rd.releaseLock();"],
    ["resp.body getter", "resp.body;"],
    ["resp.clone()", "resp.clone();"],
  ])(
    "Bun.write(path, fetch()) after the body was exposed as a stream does not use a freed FetchTasklet (%s)",
    async (_name, expose) => {
      using dir = tempDir("bun-write-fetch-freed-tasklet", {});
      const out = JSON.stringify(join(String(dir), "out.bin"));
      const fixture = `
        const server = Bun.serve({ port: 0, fetch: () => new Response(Buffer.alloc(200000, "x")) });
        for (let i = 0; i < 8; i++) {
          const resp = await fetch(\`http://127.0.0.1:\${server.port}/\`);
          ${expose}
          await Bun.sleep(5);
          await Promise.race([Bun.write(${out}, resp).catch(() => {}), Bun.sleep(100)]);
        }
        console.log("done");
        server.stop(true);
        process.exit(0);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        // detect_leaks=0: the write promise never settles on a stream-backed
        // body (#13237), so WriteFileWaitFromLockedValueTask is still live at
        // process.exit; this test is about the heap-use-after-free only.
        env: {
          ...bunEnv,
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
        },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "done", stderr: "", exitCode: 0 });
    },
  );

  it("Bun.write(path, HTMLRewriter.transform(resp)) still resolves after out.body is touched", async () => {
    using dir = tempDir("bun-write-htmlrewriter-body", {});
    const dest = join(String(dir), "out.html");
    const { promise: gate, resolve: openGate } = Promise.withResolvers();
    await using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          async function* () {
            yield "<html><body>";
            await gate;
            yield "<p>hi</p></body></html>";
          },
          { headers: { "content-type": "text/html" } },
        ),
    });
    const resp = await fetch(server.url);
    const out = new HTMLRewriter().on("*", {}).transform(resp);
    const write = Bun.write(dest, out);
    expect(out.body).toBeInstanceOf(ReadableStream);
    openGate();
    const written = await write;
    expect(written).toBe(35);
    expect(await Bun.file(dest).text()).toBe("<html><body><p>hi</p></body></html>");
  });

  // Bun.write is reading the body, so it is used: clone() throws (as it does after .text()), and
  // the write is unaffected.
  it("Bun.write(path, HTMLRewriter.transform(resp)) survives clone() while a handler is suspended", async () => {
    using dir = tempDir("bun-write-htmlrewriter-clone", {});
    const dest = join(String(dir), "out.html");
    const { promise: suspended, resolve: onSuspend } = Promise.withResolvers();
    const { promise: gate, resolve: openGate } = Promise.withResolvers();
    const out = new HTMLRewriter()
      .on("p", {
        async element(el) {
          onSuspend();
          await gate;
          el.setInnerContent("x");
        },
      })
      .transform(new Response("<p>y</p>"));
    const write = Bun.write(dest, out);
    await suspended;
    expect(out.bodyUsed).toBe(true);
    expect(() => out.clone()).toThrow(expect.objectContaining({ code: "ERR_BODY_ALREADY_USED" }));
    openGate();
    expect(await write).toBe(8);
    expect(await Bun.file(dest).text()).toBe("<p>x</p>");
  });

  describe("Bun.write(path, response) streams the body to the file", () => {
    const CHUNK = 64 * 1024;
    const COUNT = 64; // 4 MiB
    // Serves COUNT chunks; with `gate`, the second half only once it opens.
    // node:http rather than Bun.serve: no server-side Response objects to muddy a Response count.
    async function origin(gate) {
      const payload = Buffer.alloc(CHUNK, "a");
      const server = http.createServer(async (req, res) => {
        // The client may go away mid-body (a failed write cancels the source, or the test ends).
        res.on("error", () => {});
        if (req.url.endsWith("/small")) return res.end(payload.subarray(0, 1000));
        res.writeHead(200, { "content-length": String(CHUNK * COUNT) });
        for (let i = 0; i < COUNT && !res.destroyed; i++) {
          if (gate && i === COUNT / 2) await gate;
          if (!res.write(payload)) await once(res, "drain").catch(() => {});
        }
        if (!res.destroyed) res.end();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return {
        url: new URL(`http://127.0.0.1:${server.address().port}/`),
        [Symbol.asyncDispose]: () => new Promise(resolve => server.closeAllConnections() || server.close(resolve)),
      };
    }

    it("resolves with the byte count and replaces a longer existing file", async () => {
      using dir = tempDir("bun-write-response-stream", { "out.bin": Buffer.alloc(CHUNK * COUNT + 12345, "z") });
      await using server = await origin();
      const dest = join(String(dir), "out.bin");
      expect(await Bun.write(dest, await fetch(server.url))).toBe(CHUNK * COUNT);
      expect(fs.statSync(dest).size).toBe(CHUNK * COUNT);
    });

    it("writes as the body arrives, and a collected Response does not stop it", async () => {
      using dir = tempDir("bun-write-response-collected", {});
      const dest = join(String(dir), "deep", "er", "out.bin");
      const { promise: gate, resolve: openGate } = Promise.withResolvers();
      await using server = await origin(gate);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const onDisk = new Promise(resolve => {
        const watcher = fs.watch(path.dirname(dest), () => {
          if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
            watcher.close();
            resolve();
          }
        });
      });
      // Its own frame: after it returns only Bun.write refers to the body.
      let response;
      async function start() {
        const res = await fetch(server.url);
        response = new WeakRef(res);
        return Bun.write(dest, res);
      }
      const written = start();
      // The first half is on disk before the second half is sent. Before, nothing was written
      // until the whole body had been collected in memory.
      await onDisk;
      // One full collection per event-loop turn (an fs round trip) until the Response is gone.
      do {
        await fs.promises.stat(dest);
        Bun.gc(true);
      } while (response.deref());
      openGate();
      // Before #40278 was fixed this never settled once the Response had been collected.
      expect(await written).toBe(CHUNK * COUNT);
      expect(fs.statSync(dest).size).toBe(CHUNK * COUNT);
    });

    it("a body whose stream was already touched", async () => {
      using dir = tempDir("bun-write-response-touched", {});
      await using server = await origin();
      const res = await fetch(server.url);
      expect(res.body).toBeInstanceOf(ReadableStream);
      expect(await Bun.write(join(String(dir), "out.bin"), res)).toBe(CHUNK * COUNT);
      expect(res.bodyUsed).toBe(true);
    });

    // https://github.com/oven-sh/bun/issues/13237: this never settled.
    it("a Response around a JS ReadableStream, counting string chunks by their UTF-8 length", async () => {
      using dir = tempDir("bun-write-response-js-stream", {});
      const dest = join(String(dir), "out.txt");
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue("héllo ");
          ctrl.enqueue(new TextEncoder().encode("stream "));
          ctrl.enqueue("\u{1f600}");
          ctrl.close();
        },
      });
      const expected = Buffer.from("héllo stream \u{1f600}");
      expect(await Bun.write(dest, new Response(stream))).toBe(expected.length);
      expect(Buffer.from(await Bun.file(dest).arrayBuffer())).toEqual(expected);
    });

    // /dev/full: every write fails with ENOSPC.
    it.skipIf(process.platform !== "linux")("rejects with the write error, for each kind of body", async () => {
      await using server = await origin();
      const streamed = await fetch(server.url);
      // A body that is all here behind an untouched `.body` stream is written as a blob.
      const arrived = new Response(await (await fetch(server.url + "small")).blob());
      expect(arrived.body).toBeInstanceOf(ReadableStream);
      const js = new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new Uint8Array(1000));
            ctrl.close();
          },
        }),
      );
      for (const res of [streamed, arrived, js]) {
        await expect(Bun.write("/dev/full", res)).rejects.toThrow(expect.objectContaining({ code: "ENOSPC" }));
      }
    });

    // https://github.com/oven-sh/bun/issues/31681: these wrote "[object ReadableStream]".
    it("a bare ReadableStream: res.body, a JS stream, file.write(stream)", async () => {
      using dir = tempDir("bun-write-readable-stream", {});
      await using server = await origin();
      const viaBody = join(String(dir), "body.bin");
      expect(await Bun.write(viaBody, (await fetch(server.url)).body)).toBe(CHUNK * COUNT);
      expect(fs.statSync(viaBody).size).toBe(CHUNK * COUNT);

      const viaJs = join(String(dir), "js.txt");
      const js = () =>
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue("one ");
            ctrl.enqueue(new TextEncoder().encode("two"));
            ctrl.close();
          },
        });
      expect(await Bun.write(viaJs, js())).toBe(7);
      expect(await Bun.file(viaJs).text()).toBe("one two");
      expect(await Bun.file(join(String(dir), "file-write.txt")).write(js())).toBe(7);
      expect(await Bun.file(join(String(dir), "file-write.txt")).text()).toBe("one two");

      const locked = js();
      locked.getReader();
      await expect(Bun.write(viaJs, locked)).rejects.toThrow(
        expect.objectContaining({ code: "ERR_BODY_ALREADY_USED" }),
      );
      expect(await Bun.file(viaJs).text()).toBe("one two");
    });

    it("a Request body inside Bun.serve", async () => {
      using dir = tempDir("bun-write-request-stream", {});
      const dest = join(String(dir), "upload.bin");
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          return new Response(String(await Bun.write(dest, req)));
        },
      });
      const body = Buffer.alloc(3 * CHUNK * COUNT, "b");
      const res = await fetch(server.url, { method: "POST", body });
      expect({ written: Number(await res.text()), size: fs.statSync(dest).size }).toEqual({
        written: body.length,
        size: body.length,
      });
    });

    it("rejects with the network error when the body is cut short", async () => {
      using dir = tempDir("bun-write-response-truncated", {});
      using listener = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: {
          data(socket) {
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n" + Buffer.alloc(1000, "a").toString());
            socket.flush();
            socket.end();
          },
        },
      });
      const res = await fetch(`http://127.0.0.1:${listener.port}/`);
      await expect(Bun.write(join(String(dir), "out.bin"), res)).rejects.toThrow(
        expect.objectContaining({ code: "ECONNRESET" }),
      );
    });

    it("rejects a body that was already used, and createPath: false into a missing directory", async () => {
      using dir = tempDir("bun-write-response-rejects", {});
      await using server = await origin();
      const used = await fetch(server.url);
      await used.arrayBuffer();
      await expect(Bun.write(join(String(dir), "a"), used)).rejects.toThrow(
        expect.objectContaining({ code: "ERR_BODY_ALREADY_USED" }),
      );
      const reading = await fetch(server.url);
      const reader = reading.body.getReader();
      await expect(Bun.write(join(String(dir), "b"), reading)).rejects.toThrow(
        expect.objectContaining({ code: "ERR_BODY_ALREADY_USED" }),
      );
      reader.releaseLock();
      // Also when the whole body is already here.
      const small = new Response("hello");
      const smallReader = small.body.getReader();
      await expect(Bun.write(join(String(dir), "s"), small)).rejects.toThrow(
        expect.objectContaining({ code: "ERR_BODY_ALREADY_USED" }),
      );
      expect(await smallReader.read().then(r => r.value.byteLength)).toBe(5);
      // A destination that cannot be opened (the directory itself) leaves the body usable.
      const retry = await fetch(server.url);
      await expect(Bun.write(String(dir), retry)).rejects.toThrow(
        expect.objectContaining({ code: "EISDIR", syscall: "open" }),
      );
      expect(retry.bodyUsed).toBe(false);
      expect((await retry.arrayBuffer()).byteLength).toBe(CHUNK * COUNT);
      await expect(
        Bun.write(join(String(dir), "missing", "c"), await fetch(server.url), { createPath: false }),
      ).rejects.toThrow(expect.objectContaining({ code: "ENOENT" }));
    });
  });

  it("BunFile.name survives concurrent write() calls + GC", async () => {
    using dir = tempDir("bun-file-name-concurrent-write-gc", {});
    const filePath = join(String(dir), "out.txt");

    const f = Bun.file(filePath);
    f.name;

    const writes = [];
    for (let i = 0; i < 8; i++) {
      writes.push(f.write("x").catch(() => {}));
    }
    Bun.gc(true);
    await Promise.all(writes);
    Bun.gc(true);

    expect(f.name).toBe(filePath);
  });
});
