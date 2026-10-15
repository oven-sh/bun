import { describe, expect, it, test } from "bun:test";
import fs, { mkdirSync } from "fs";
import {
  bunEnv,
  bunExe,
  exampleHtml,
  exampleSite,
  gcTick,
  isASAN,
  isMacOS,
  isWindows,
  tempDir,
  withoutAggressiveGC,
} from "harness";
import { once } from "node:events";
import http from "node:http";
import { finished } from "node:stream/promises";
import path, { join } from "path";
import { asyncIterableBodyShapes, settled as settledBody } from "../../web/streams/async-iterable-body-shapes";

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

  // https://github.com/oven-sh/bun/issues/42060
  it("Bun.write(existing path, Bun.file(src)) resolves to the number of bytes copied", async () => {
    using dir = tempDir("bun-write-existing-dest", {
      "existing.bin": "placeholder",
    });
    const size = 1024 * 1024 + 7;
    const src = join(String(dir), "src.bin");
    await Bun.write(src, new Uint8Array(size).fill(7));
    const existing = join(String(dir), "existing.bin");

    expect(await Bun.write(existing, Bun.file(src))).toBe(size);
    expect(fs.statSync(existing).size).toBe(size);

    expect(await Bun.write(Bun.file(existing).slice(0, 1000), Bun.file(src))).toBe(1000);
    expect(fs.statSync(existing).size).toBe(1000);

    const small = join(String(dir), "small.bin");
    await Bun.write(small, new Uint8Array(100).fill(9));
    expect(await Bun.write(Bun.file(existing).slice(0, 1000), Bun.file(small))).toBe(100);
    expect(fs.statSync(existing).size).toBe(100);
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

  describe("empty source to a path", () => {
    // These sources have no bytes and no Blob store. On POSIX the string and the
    // TypedArray below take a different route: a path must answer all of them the same way.
    const storelessSources = {
      "Blob([])": () => new Blob([]),
      'Blob([""])': () => new Blob([""]),
      "File([])": () => new File([], "empty.txt"),
      "[]": () => [],
      'Response("")': () => new Response(""),
      "Response(null)": () => new Response(null),
      "Request with an empty body": () => new Request("http://localhost/", { method: "POST", body: "" }),
    };
    const emptySpellings = { '""': () => "", "Uint8Array(0)": () => new Uint8Array(0), ...storelessSources };
    // Source text of five of the spellings, for a child process.
    const emptySourceExprs = [`""`, `new Uint8Array(0)`, `new Blob([])`, `new Response("")`, `[]`];
    const pathDoors = {
      "Bun.write(path, src)": (p, src, options) => Bun.write(p, src, options),
      "Bun.write(Bun.file(path), src)": (p, src, options) => Bun.write(Bun.file(p), src, options),
      "Bun.file(path).write(src)": (p, src, options) => Bun.file(p).write(src, options),
    };
    const settle = promise =>
      promise.then(
        ret => ({ ret }),
        e => ({ code: e.code, syscall: e.syscall, path: e.path }),
      );
    // What the write left at `p`: the contents of a file, or null for anything else.
    const left = p => (fs.statSync(p, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(p, "utf8") : null);
    // Runs a child and returns what it printed.
    const run = async options => {
      await using proc = Bun.spawn({ env: bunEnv, stdout: "pipe", stderr: "pipe", ...options });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    };
    // Source text that writes each of `exprs` to `destExpr` and prints what each call settled to.
    const writeEach = (exprs, destExpr) => `
      const results = [];
      for (const src of [${exprs.join(", ")}]) {
        results.push(
          await Bun.write(${destExpr}, src).then(ret => ({ ret }), e => ({ code: e.code, syscall: e.syscall })),
        );
      }
      console.log(JSON.stringify(results));
    `;
    const printed = results => ({ stdout: JSON.stringify(results), stderr: "", exitCode: 0 });

    it("gives one result for each of the nine sources and each entry point", async () => {
      using dir = tempDir("bun-write-empty-path", {});
      const root = String(dir);
      // Windows keeps its own code for an empty source. The call that its errors name is not pinned here.
      const syscall = isWindows ? expect.any(String) : "open";
      const kinds = {
        "a file that exists is emptied": {
          dest: name => path.join(root, name),
          prepare: p => fs.writeFileSync(p, "EXISTING"),
          expected: () => ({ ret: 0, left: "" }),
        },
        "a new file is created": {
          dest: name => path.join(root, name),
          expected: () => ({ ret: 0, left: "" }),
        },
        "createPath: false creates the file when its directory exists": {
          dest: name => path.join(root, name),
          options: { createPath: false },
          expected: () => ({ ret: 0, left: "" }),
        },
        "a missing directory is created": {
          dest: name => path.join(root, `made-for-${name}`, "sub", name),
          expected: () => ({ ret: 0, left: "" }),
        },
        "createPath: false rejects when the directory is missing": {
          dest: name => path.join(root, `missing-for-${name}`, name),
          options: { createPath: false },
          expected: p => ({ code: "ENOENT", syscall, path: p, left: null }),
        },
        "a directory rejects": {
          dest: () => root,
          // Windows truncates the handle of the directory. Only a store-less source pins that code.
          expected: (p, spelling) => ({
            code: !isWindows ? "EISDIR" : spelling in storelessSources ? "EINVAL" : expect.any(String),
            syscall,
            path: p,
            left: null,
          }),
        },
      };
      const results = [];
      const expected = [];
      for (const [kind, { dest, prepare, options, expected: expectedFor }] of Object.entries(kinds)) {
        for (const [door, write] of Object.entries(pathDoors)) {
          for (const [spelling, make] of Object.entries(emptySpellings)) {
            const p = dest(`out-${results.length}.txt`);
            prepare?.(p);
            results.push({ kind, door, spelling, ...(await settle(write(p, make(), options))), left: left(p) });
            expected.push({ kind, door, spelling, ...expectedFor(p, spelling) });
          }
        }
      }
      expect(results).toEqual(expected);
    });

    it("creates a bare filename in the working directory", async () => {
      using dir = tempDir("bun-write-empty-bare", {});
      const script = `
        const sources = () => [${emptySourceExprs.join(", ")}];
        const settle = promise => promise.then(ret => ({ ret }), e => ({ code: e.code, syscall: e.syscall }));
        const results = [];
        for (let i = 0; i < ${emptySourceExprs.length}; i++) {
          results.push(await settle(Bun.write("write-" + i + ".txt", sources()[i])));
          results.push(await settle(Bun.file("file-" + i + ".txt").write(sources()[i])));
        }
        console.log(JSON.stringify(results));
      `;
      const child = await run({ cmd: [bunExe(), "-e", script], cwd: String(dir) });
      const names = emptySourceExprs.flatMap((_, i) => [`file-${i}.txt`, `write-${i}.txt`]);
      expect({ ...child, files: fs.readdirSync(String(dir)).sort() }).toEqual({
        ...printed(names.map(() => ({ ret: 0 }))),
        files: names.sort(),
      });
    });

    // A symlink whose target is in a missing directory. A bare filename has no directory
    // to create, so the error is the one from the open.
    it.skipIf(isWindows)("names the open for a bare filename that is a dangling symlink", async () => {
      using dir = tempDir("bun-write-empty-dangling", {});
      fs.symlinkSync(path.join("missing", "target"), path.join(String(dir), "dangling"));
      const sourceExprs = [...emptySourceExprs, `"x"`, `new Blob(["x"])`];
      const child = await run({ cmd: [bunExe(), "-e", writeEach(sourceExprs, `"dangling"`)], cwd: String(dir) });
      expect(child).toEqual(printed(sourceExprs.map(() => ({ code: "ENOENT", syscall: "open" }))));
    });

    // A Bun.file whose stat is cached as a regular file, or one that has an offset, skips the
    // POSIX fast path: the string and the TypedArray then go the way of the store-less sources.
    it("creates the file through a Bun.file that skips the fast path", async () => {
      using dir = tempDir("bun-write-empty-slow-door", {});
      const statCached = async (p, prime) => {
        fs.writeFileSync(p, "OLD");
        const file = Bun.file(p);
        await prime(file);
        fs.rmSync(p);
        return file;
      };
      const doors = {
        "Bun.file(path) after exists()": p => statCached(p, file => file.exists()),
        "Bun.file(path) after .size": p => statCached(p, file => file.size),
        "Bun.file(path).slice(1)": p => Bun.file(p).slice(1),
      };
      const results = [];
      const expected = [];
      for (const [door, open] of Object.entries(doors)) {
        for (const [spelling, make] of Object.entries(emptySpellings)) {
          const p = path.join(String(dir), `out-${results.length}.txt`);
          const dest = await open(p);
          results.push({
            door,
            spelling,
            ...(await settle(Bun.write(dest, make(), { createPath: false }))),
            left: left(p),
          });
          expected.push({ door, spelling, ret: 0, left: "" });
        }
      }
      expect(results).toEqual(expected);
    });

    // A body that has no bytes when Bun.write gets it, or that ends later without any.
    it("creates the file for an empty Response or Request body", async () => {
      using dir = tempDir("bun-write-empty-body-path", {});
      const root = String(dir);
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/204") return new Response(null, { status: 204 });
          // The server writes the Request it received.
          if (url.pathname === "/sink") {
            return Response.json(await settle(Bun.write(url.searchParams.get("to"), req, { createPath: false })));
          }
          return new Response("");
        },
      });
      // This origin sends the head at once and ends the body, with no bytes, on `release`.
      const release = Promise.withResolvers();
      using late = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket) {
            socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
            release.promise.then(() => socket.end("0\r\n\r\n"));
          },
        },
      });
      const closed = () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        });
      const sources = {
        "fetch() with Content-Length: 0": () => fetch(server.url),
        "fetch() with status 204": () => fetch(new URL("/204", server.url)),
        "Response with a closed stream": () => new Response(closed()),
        "Request with a closed stream": () => new Request(server.url, { method: "POST", body: closed() }),
      };
      const results = [];
      for (const [source, make] of Object.entries(sources)) {
        const p = path.join(root, `out-${results.length}.txt`);
        results.push({ source, ...(await settle(Bun.write(p, await make(), { createPath: false }))), left: left(p) });
      }

      const sunk = path.join(root, "sunk.txt");
      const answer = await fetch(new URL(`/sink?to=${encodeURIComponent(sunk)}`, server.url), { method: "POST" });
      results.push({ source: "a Request with no body, in the server", ...(await answer.json()), left: left(sunk) });

      const ended = path.join(root, "ended.txt");
      const pending = settle(Bun.write(ended, await fetch(`http://127.0.0.1:${late.port}/`), { createPath: false }));
      release.resolve();
      results.push({ source: "fetch() with a body that ends later", ...(await pending), left: left(ended) });

      expect(results).toEqual(
        [...Object.keys(sources), "a Request with no body, in the server", "fetch() with a body that ends later"].map(
          source => ({ source, ret: 0, left: "" }),
        ),
      );
    });

    const resolvesOnDevice = async device => {
      const results = [];
      const expected = [];
      for (const [door, write] of Object.entries(pathDoors)) {
        for (const [spelling, make] of Object.entries(emptySpellings)) {
          results.push({ door, spelling, ...(await settle(write(device, make()))) });
          expected.push({ door, spelling, ret: 0 });
        }
      }
      results.push({ isCharacterDevice: fs.statSync(device).isCharacterDevice() });
      expected.push({ isCharacterDevice: true });
      expect(results).toEqual(expected);
    };
    // Not fixed on Windows: "/dev/null" names NUL there, and an empty source still truncates it.
    it.todoIf(isWindows)("resolves 0 on /dev/null and leaves the device in place", () => resolvesOnDevice("/dev/null"));
    it.skipIf(isWindows)("resolves 0 on /dev/zero and leaves the device in place", () => resolvesOnDevice("/dev/zero"));

    // The shell gives the child a pipe for stdout. Bun.spawn gives it a socket, which
    // "/dev/stdout" cannot open on Linux.
    it.skipIf(isWindows)("resolves 0 on /dev/stdout in a pipeline", async () => {
      const child = await run({
        cmd: ["sh", "-c", `"$BUN_EXE" -e "$SCRIPT" | cat`],
        env: { ...bunEnv, BUN_EXE: bunExe(), SCRIPT: writeEach(emptySourceExprs, `"/dev/stdout"`) },
      });
      expect(child).toEqual(printed(emptySourceExprs.map(() => ({ ret: 0 }))));
    });

    // mkfifo(1) is POSIX. The open must not wait for a reader: a child runs it, so a
    // blocked open fails this test and does not stop the runner.
    it.skipIf(isWindows)("rejects on a FIFO that nobody reads, like a write that has bytes", async () => {
      using dir = tempDir("bun-write-empty-fifo", {});
      const fifo = path.join(String(dir), "fifo");
      expect(Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);
      const sourceExprs = [...emptySourceExprs, `"x"`, `new Blob(["x"])`];
      const child = await run({
        cmd: [bunExe(), "-e", writeEach(sourceExprs, "process.env.FIFO")],
        env: { ...bunEnv, FIFO: fifo },
      });
      expect(child).toEqual(printed(sourceExprs.map(() => ({ code: "ENXIO", syscall: "open" }))));
    });

    // The child holds every free descriptor, so the open fails as it does for a write that has
    // bytes. Then four are free again, and each write must give back the one that it takes.
    it.skipIf(isWindows)("rejects with EMFILE when no descriptor is free, and closes the one it opens", async () => {
      using dir = tempDir("bun-write-empty-emfile", { "exist.txt": "EXISTING" });
      const sourceExprs = [...emptySourceExprs, `"x"`, `new Blob(["x"])`];
      const script = `
        const fs = require("fs");
        const settle = promise => promise.then(ret => ({ ret }), e => ({ code: e.code, syscall: e.syscall }));
        const held = [];
        for (;;) {
          try {
            held.push(fs.openSync("/dev/null", "r"));
          } catch {
            break;
          }
        }
        const atTheLimit = [];
        for (const src of [${sourceExprs.join(", ")}]) atTheLimit.push(await settle(Bun.write("exist.txt", src)));
        for (let i = 0; i < 4; i++) fs.closeSync(held.pop());
        let resolved = 0;
        for (let i = 0; i < 100; i++) {
          const src = [${emptySourceExprs.slice(2).join(", ")}][i % 3];
          if ((await settle(Bun.write("exist.txt", src))).ret === 0) resolved++;
        }
        // LeakSanitizer opens files when the process exits.
        for (const fd of held) fs.closeSync(fd);
        console.log(JSON.stringify({ held: held.length > 0, atTheLimit, resolved }));
      `;
      const child = await run({
        cmd: ["sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), "-e", script],
        cwd: String(dir),
      });
      expect(child).toEqual(
        printed({
          held: true,
          atTheLimit: sourceExprs.map(() => ({ code: "EMFILE", syscall: "open" })),
          resolved: 100,
        }),
      );
    });

    // Windows has no permission bits to compare.
    it.skipIf(isWindows)("passes mode to the open that creates the file", async () => {
      using dir = tempDir("bun-write-empty-mode", {});
      const results = [];
      for (const [spelling, make] of Object.entries(storelessSources)) {
        const p = path.join(String(dir), `out-${results.length}.txt`);
        const ret = await Bun.write(p, make(), { mode: 0o600 });
        results.push({ spelling, ret, mode: fs.statSync(p).mode & 0o777 });
      }
      expect(results).toEqual(
        Object.keys(storelessSources).map(spelling => ({ spelling, ret: 0, mode: 0o600 & ~process.umask() })),
      );
    });

    // `chflags uchg` locks a file against its owner. Linux needs root for the same.
    it.skipIf(!isMacOS)("reports EPERM for a file that is locked", async () => {
      using dir = tempDir("bun-write-empty-locked", { "locked.txt": "LOCKED" });
      const p = path.join(String(dir), "locked.txt");
      expect(Bun.spawnSync({ cmd: ["chflags", "uchg", p] }).exitCode).toBe(0);
      try {
        const results = [];
        for (const [spelling, make] of Object.entries(emptySpellings)) {
          results.push({ spelling, ...(await settle(Bun.write(p, make(), { createPath: false }))), left: left(p) });
        }
        expect(results).toEqual(
          Object.keys(emptySpellings).map(spelling => ({
            spelling,
            code: "EPERM",
            syscall: "open",
            path: p,
            left: "LOCKED",
          })),
        );
      } finally {
        Bun.spawnSync({ cmd: ["chflags", "nouchg", p] });
      }
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

    // A direct stream's pull() runs once; its promise resolving without close() is the end of the
    // body, as for Bun.serve. Before, bytes written after the sink's last flush were dropped while
    // the resolved count still included them, and the sink was freed with its JS controller still
    // attached, which read the freed sink once the controller was collected.
    it("a direct stream whose pull() resolves without close()", async () => {
      using dir = tempDir("bun-write-direct-no-close", {});
      const dest = join(String(dir), "out.txt");
      const fixture = /* js */ `
        const { fileSinkInternals } = require("bun:internal-for-testing");
        const nextTask = () => new Promise(resolve => setImmediate(resolve));
        const baseline = fileSinkInternals.liveCount();
        let controller;
        let stream = new ReadableStream({
          type: "direct",
          async pull(c) {
            controller = c;
            c.write("hello");
            // The sink flushes "hello" to the file before this resolves.
            await nextTask();
            c.write(" ");
            c.write(new TextEncoder().encode("wörld"));
          },
        });
        const written = await Bun.write(process.env.DEST, new Response(stream));
        const onDisk = await Bun.file(process.env.DEST).text();
        // The stream ended when pull() resolved: the controller is closed and detached.
        const late = {};
        for (const method of ["write", "flush", "end"]) {
          try {
            late[method] = String(controller[method]("late"));
          } catch (e) {
            late[method] = e.message.split(".")[0];
          }
        }
        // Collect the stream and its sink controller.
        stream = controller = undefined;
        Bun.gc(true);
        await nextTask();
        Bun.gc(true);
        console.log(JSON.stringify({ written, onDisk, late, leakedSinks: fileSinkInternals.liveCount() - baseline }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, DEST: dest },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        written: 12,
        onDisk: "hello wörld",
        late: {
          write: "This FileSink has already been closed",
          flush: "This FileSink has already been closed",
          end: "undefined",
        },
        leakedSinks: 0,
      });
      expect(exitCode).toBe(0);
    });

    // close(error) fails the sink from inside FileSink's own close path, which re-enters the controller before the
    // C++ caller passes the reason along. The stream must still end Errored with that reason, not Closed.
    it.each([
      ["inside a sync pull()", c => (c.write("a"), c.close(new Error("boom")))],
      ["inside an async pull() after a flush", async c => (c.write("a"), await c.flush(), c.close(new Error("boom")))],
      ["from a later task on a kept controller", null],
    ])("close(error) %s errors the direct stream it came from", async (_where, pull) => {
      using dir = tempDir("bun-write-direct-close-error-state", {});
      let kept;
      const stream = new ReadableStream({
        type: "direct",
        pull: pull ?? (c => ((kept = c), c.write("a"))),
      });
      const written = Bun.write(join(String(dir), "out.txt"), stream);
      if (!pull) {
        await new Promise(resolve => setImmediate(resolve));
        kept.close(new Error("boom"));
      }
      expect(
        await written.then(
          () => "resolved",
          e => "rejected: " + e.message,
        ),
      ).toBe("rejected: boom");
      // The stream stays locked to the sink that consumed it, so finished() is what observes its terminal state.
      expect(
        await finished(stream).then(
          () => "closed",
          e => "errored: " + e.message,
        ),
      ).toBe("errored: boom");
      expect(stream.locked).toBe(true);
    });

    // Only an Error was taken for a failure. With anything else the promise stayed pending.
    it.each([[42], ["boom"], [{ code: "E" }], [undefined]])(
      "a direct stream whose pull() throws %p rejects with that",
      async thrown => {
        using dir = tempDir("bun-write-direct-pull-throws", {});
        const stream = new ReadableStream({
          type: "direct",
          pull() {
            throw thrown;
          },
        });
        expect(
          await Bun.write(join(String(dir), "out.txt"), stream).then(
            () => ({ resolved: true }),
            rejected => ({ rejected }),
          ),
        ).toEqual({ rejected: thrown });
      },
    );

    it("a stream whose source fails rejects with that error", async () => {
      using dir = tempDir("bun-write-stream-reject", {});
      const nextTask = () => new Promise(resolve => setImmediate(resolve));
      const direct = new ReadableStream({
        type: "direct",
        async pull(c) {
          c.write("hello");
          await nextTask();
          throw new Error("boom");
        },
      });
      await expect(Bun.write(join(String(dir), "direct.txt"), new Response(direct))).rejects.toThrow("boom");
      const generator = async function* () {
        yield "hello";
        await nextTask();
        throw new Error("boom");
      };
      await expect(Bun.write(join(String(dir), "generator.txt"), new Response(generator()))).rejects.toThrow("boom");
      const midway = new ReadableStream({
        async pull(c) {
          c.enqueue("hello");
          await nextTask();
          c.error(new Error("boom"));
        },
      });
      await expect(Bun.write(join(String(dir), "midway.txt"), midway)).rejects.toThrow("boom");
      const upfront = new ReadableStream({
        start(c) {
          c.error(new Error("boom"));
        },
      });
      await expect(Bun.write(join(String(dir), "upfront.txt"), upfront)).rejects.toThrow("boom");
    });

    // The sink is released when the pump rejects; a controller collected after that must
    // already be detached. A subprocess, because that GC can be the one at process exit.
    it("survives a GC after a direct stream or a generator body fails", async () => {
      using dir = tempDir("bun-write-body-fails-gc", {});
      const fixture = /* js */ `
        const dir = process.env.DEST_DIR;
        const lines = [];
        try {
          await Bun.write(dir + "/gen.txt", new Response((async function* () { yield "a"; throw new Error("boom"); })()));
        } catch (e) {
          lines.push("gen:" + e.message);
        }
        let controller;
        try {
          await Bun.write(
            dir + "/direct.txt",
            new Response(
              new ReadableStream({
                type: "direct",
                async pull(c) {
                  controller = c;
                  c.write("a");
                  await c.flush();
                  throw new Error("boom");
                },
              }),
            ),
          );
        } catch (e) {
          lines.push("direct:" + e.message);
        }
        try {
          lines.push("late:" + controller.write("late"));
        } catch {
          lines.push("late:threw");
        }
        controller = undefined;
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
        Bun.gc(true);
        console.log(lines.join(","));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, DEST_DIR: String(dir) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("gen:boom,direct:boom,late:threw");
      expect(exitCode).toBe(0);
    });

    // The implicit end closes the stream like controller.close(): cancel() does not run (nobody aborted), and write()/flush() on the detached controller throw.
    it("ends a direct stream's sink when its pull() returns", async () => {
      using dir = tempDir("bun-write-direct-pull-returns", {});
      const dest = join(String(dir), "out.txt");
      let ctrl;
      const cancelled = [];
      const stream = new ReadableStream({
        type: "direct",
        async pull(c) {
          ctrl = c;
          c.write("first ");
          await c.flush();
          // A later event loop turn: "second" is still buffered in the sink when pull() returns.
          await new Promise(resolve => setImmediate(resolve));
          c.write("second");
        },
        cancel(reason) {
          cancelled.push(reason);
        },
      });
      expect(await Bun.write(dest, new Response(stream))).toBe(12);
      expect(await Bun.file(dest).text()).toBe("first second");
      expect(cancelled).toStrictEqual([]);
      expect(() => ctrl.write("late event")).toThrow("This FileSink has already been closed");
      expect(() => ctrl.flush()).toThrow("This FileSink has already been closed");
      expect(ctrl.end()).toBeUndefined();
      Bun.gc(true);
    });

    // Every way the JS pump can settle without a controller.close(), each followed by a full GC
    // with the controller cell unreferenced. Before, the cell kept a pointer to the freed FileSink
    // and the collection (or the sink's queued flush task) was a use-after-free. `await 1` settles
    // in the tick the write started in; `tick()` settles on a later event-loop turn.
    it.each([
      [
        "an async generator that throws right after a yield",
        `async function* () { yield "first"; throw new Error("boom"); }`,
        "rejected: boom",
      ],
      [
        "an async generator that throws before its first yield",
        `async function* () { throw new Error("boom"); }`,
        "rejected: boom",
      ],
      [
        "an async generator that throws on a later tick",
        `async function* () { yield "first"; await tick(); throw new Error("boom"); }`,
        "rejected: boom",
      ],
      [
        "a direct ReadableStream whose pull rejects",
        `() => new ReadableStream({ type: "direct", async pull(ctrl) { ctrl.write("first"); await 1; throw new Error("boom"); } })`,
        "rejected: boom",
      ],
      [
        "a direct ReadableStream whose pull resolves without closing it",
        `() => new ReadableStream({ type: "direct", async pull(ctrl) { ctrl.write("first"); await 1; } })`,
        `resolved: 5, "first"`,
      ],
      [
        "a direct ReadableStream whose pull resolves on a later tick without closing it",
        `() => new ReadableStream({ type: "direct", async pull(ctrl) { ctrl.write("first"); await tick(); } })`,
        `resolved: 5, "first"`,
      ],
    ])("the body's sink controller is collectable after %s", async (_label, body, outcome) => {
      using dir = tempDir("bun-write-settled-controller", {});
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { readFileSync } = require("fs");
           const dest = ${JSON.stringify(join(String(dir), "out.txt"))};
           const tick = () => new Promise(resolve => setImmediate(resolve));
           const body = ${body};
           const outcomes = new Set();
           for (let i = 0; i < 5; i++) {
             outcomes.add(
               await Bun.write(dest, new Response(body())).then(
                 n => "resolved: " + n + ", " + JSON.stringify(readFileSync(dest, "utf8")),
                 e => "rejected: " + e.message,
               ),
             );
             Bun.gc(true);
           }
           console.log([...outcomes].join(" | "));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: outcome, stderr: "" });
      expect(exitCode).toBe(0);
    });

    // `program | head -n 1`: the reader of the pipe leaves, the next write fails, and the sink
    // hands that error to the body. setInterval() of node:timers/promises gives an iterator with
    // return() and no throw(). A leaked interval is the only thing that can keep the child alive:
    // it exits by itself once the body is closed with return(). The unref'd timer only ends a
    // child that did not.
    it.each([
      // A small write is buffered. Its failure comes back when the sink closes.
      ["small lines", `"tick\\n"`],
      // A large write goes straight to the pipe and fails at once.
      ["64 KiB lines", `Buffer.alloc(64 * 1024, "x").toString() + "\\n"`],
    ])(
      "Bun.write(Bun.stdout, new Response(asyncIterable)) closes the iterable when the reader of the pipe leaves: %s",
      async (_, line) => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `import { setInterval as every } from "node:timers/promises";
             setTimeout(() => process.exit(1), 30_000).unref();
             await Bun.write(Bun.stdout, new Response(every(1, ${line}))).then(() => {}, () => {});
             console.error("reached the end");`,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const reader = proc.stdout.getReader();
        await reader.read();
        await reader.cancel();
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("reached the end\n");
        expect(exitCode).toBe(0);
      },
    );

    // 8 MiB doesn't fit in the pipe and nobody reads it, so the write stays parked and the child
    // waits in its poll of stdout. That poll is where it learns the reader left. The sink rejects
    // the parked promise from that callback, and the JS that runs next closes the sink and drops
    // the last refs on it while the pipe writer inside it is still on the stack (ASAN:
    // heap-use-after-free). On Windows a write to stdout blocks, so "parked" would never print.
    // setImmediate() runs on a later turn of the loop, once the sink has the chunk.
    it.skipIf(isWindows).each([
      [
        "an async iterable's write",
        `(async function* () {
           try {
             setImmediate(() => console.error("parked"));
             yield Buffer.alloc(8 * 1024 * 1024, "x");
           } finally {
             console.error("closed");
           }
         })()`,
        "parked\nclosed\nEPIPE\n",
      ],
      [
        "a direct stream's flush()",
        `new ReadableStream({
           type: "direct",
           async pull(controller) {
             controller.write(Buffer.alloc(8 * 1024 * 1024, "x"));
             setImmediate(() => console.error("parked"));
             await controller.flush();
           },
         })`,
        "parked\nEPIPE\n",
      ],
    ])(
      "Bun.write(Bun.stdout, response) rejects with EPIPE when the reader of the pipe leaves while %s is parked",
      async (_, body, expected) => {
        // The read end is held open and never read. `proc.stdout.cancel()` starts a read first, which can drain it all.
        using dir = tempDir("bun-write-epipe", {});
        const fifo = join(String(dir), "fifo");
        expect(Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);
        const held = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const stdout = fs.openSync(fifo, "w");
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `await Bun.write(Bun.stdout, new Response(${body})).catch(e => console.error(e.code));`,
          ],
          env: bunEnv,
          stdout,
          stderr: "pipe",
        });
        fs.closeSync(stdout);
        const decoder = new TextDecoder();
        let stderr = "";
        for await (const chunk of proc.stderr) {
          const wasParked = stderr.includes("parked\n");
          stderr += decoder.decode(chunk, { stream: true });
          if (!wasParked && stderr.includes("parked\n")) fs.closeSync(held);
        }
        expect(stderr).toBe(expected);
        expect(await proc.exited).toBe(0);
      },
    );

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

    // The write error also closes an async-iterable body: return(), and nothing is thrown into it.
    // The body has an end, so a body that was not closed fails on its calls and does not run for ever.
    describe.skipIf(process.platform !== "linux").each(asyncIterableBodyShapes)(
      "a write that fails with ENOSPC closes %s with return()",
      (_, make) => {
        it.each([
          // A small write is buffered. Its failure comes back when the sink closes.
          ["chunks of 6 bytes", "chunk\n"],
          // A large write goes straight to the file and fails at once.
          ["chunks of 64 KiB", Buffer.alloc(64 * 1024, "x")],
        ])("%s", async (_, chunk) => {
          const shape = make({ chunk, count: 100 });
          await expect(Bun.write("/dev/full", new Response(shape.body))).rejects.toThrow(
            expect.objectContaining({ code: "ENOSPC" }),
          );
          expect(await settledBody(shape)).toEqual(shape.expected);
        });
      },
    );

    // The body ends in the same tick as its only chunk, so the only write is the flush at its end.
    it.skipIf(process.platform !== "linux").each([
      ["next() and return()", false],
      ["next(), return() and throw()", true],
    ])(
      "a flush at the end of the body that fails with ENOSPC closes an iterator with %s with return()",
      async (_, withThrow) => {
        const calls = [];
        let given = 0;
        const iterator = {
          [Symbol.asyncIterator]() {
            return this;
          },
          next: async () => (given++ === 0 ? { done: false, value: "chunk\n" } : { done: true, value: undefined }),
          return: async () => (calls.push("return"), { done: true, value: undefined }),
        };
        if (withThrow) iterator.throw = async () => (calls.push("throw"), { done: true, value: undefined });
        await expect(Bun.write("/dev/full", new Response(iterator))).rejects.toThrow(
          expect.objectContaining({ code: "ENOSPC" }),
        );
        for (let turn = 0; turn < 50 && !calls.length; turn++) await new Promise(resolve => setImmediate(resolve));
        expect(calls).toEqual(["return"]);
      },
    );

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

    it("rejects a body that a pending text() waits for, and text() still resolves", async () => {
      using dir = tempDir("bun-write-response-pending-text", {});
      const sendBody = Promise.withResolvers();
      using listener = Bun.listen({
        port: 0,
        hostname: "127.0.0.1",
        socket: {
          async data(socket) {
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n");
            socket.flush();
            await sendBody.promise;
            socket.end("hello");
          },
        },
      });
      const res = await fetch(`http://127.0.0.1:${listener.port}/`);
      const text = res.text();
      await expect(Bun.write(join(String(dir), "out.txt"), res)).rejects.toThrow(
        expect.objectContaining({ code: "ERR_BODY_ALREADY_USED" }),
      );
      sendBody.resolve();
      expect(await text).toBe("hello");
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

// These writes fail before any I/O is scheduled, so the write returns a promise
// that is already rejected. Those rejections must carry the error itself and be
// reported the same way as the ones produced later by the async path.
(isWindows ? describe : describe.concurrent)("Bun.write early rejections are tracked", () => {
  // The endpoint is never contacted: the options are validated first.
  const s3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "my_bucket",
    endpoint: "http://127.0.0.1:1",
  };
  const invalidS3Options = { storageClass: "INVALID_VALUE" };
  const invalidS3Message = "storageClass must be one of";

  async function runChild(body) {
    using dir = tempDir("bun-write-early-reject", { "file.txt": "x" });
    const prelude = `
      const fs = require("fs");
      const dir = ${JSON.stringify(String(dir))};
      const file = ${JSON.stringify(join(String(dir), "file.txt"))};
      const s3file = new Bun.S3Client(${JSON.stringify(s3Options)}).file("key");
      const invalidS3Options = ${JSON.stringify(invalidS3Options)};
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + body],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.each([
    ["a string written to a directory", `Bun.write(dir, "x")`, "EISDIR"],
    ["a TypedArray written to a directory", `Bun.write(dir, new Uint8Array(4))`, "EISDIR"],
    // Truncating a directory fails with EINVAL on Windows and EISDIR elsewhere.
    ["an empty Blob written to a directory", `Bun.write(dir, new Blob([]))`, isWindows ? "EINVAL" : "EISDIR"],
    // Windows reports these two as "UV_EBADF" (errno -4083), which the substring check also accepts.
    ["a string written to a read-only file descriptor", `Bun.write(Bun.file(fs.openSync(file, "r")), "x")`, "EBADF"],
    [
      "a TypedArray written to a read-only file descriptor",
      `Bun.write(Bun.file(fs.openSync(file, "r")), new Uint8Array(4))`,
      "EBADF",
    ],
    ["BunFile.write() on a directory", `Bun.file(dir).write("x")`, "EISDIR"],
    ["an S3 write with invalid options", `s3file.write("x", invalidS3Options)`, invalidS3Message],
    [
      "an S3 write of an empty Blob with invalid options",
      `s3file.write(new Blob([]), invalidS3Options)`,
      invalidS3Message,
    ],
  ])("%s is reported as an unhandled rejection", async (_, expression, expected) => {
    const { stderr, exitCode } = await runChild(`${expression};`);
    expect(stderr).toContain(expected);
    expect(exitCode).toBe(1);
  });

  it.each([
    ["a string", () => "x"],
    ["an empty Blob", () => new Blob([])],
  ])("an S3 write of %s with invalid options rejects with the validation error itself", async (_, data) => {
    const promise = new Bun.S3Client(s3Options).file("key").write(data(), invalidS3Options);
    await expect(promise).rejects.toBeInstanceOf(TypeError);
    await expect(promise).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining(invalidS3Message),
    });
  });

  it("the returned promise is the one passed to 'unhandledRejection'", async () => {
    const { stdout, stderr, exitCode } = await runChild(`
      process.on("unhandledRejection", (reason, promise) => {
        console.log(reason.code, promise === p);
      });
      const p = Bun.write(dir, "x");
    `);
    expect(stdout).toBe("EISDIR true\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("a handled rejection is not reported", async () => {
    const { stdout, stderr, exitCode } = await runChild(`
      Bun.write(dir, "x").catch(e => console.log("caught", e.code));
    `);
    expect(stdout).toBe("caught EISDIR\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
