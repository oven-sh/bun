import { describe, expect, it, test } from "bun:test";
import fs, { mkdirSync } from "fs";
import { bunEnv, bunExe, exampleHtml, exampleSite, gcTick, isWindows, tempDir, withoutAggressiveGC } from "harness";
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

describe("Bun.write(path, response) streams to disk", () => {
  // The Locked-body destination arm streams through the FileSink instead of
  // buffering the entire body in memory first.
  const SIZE = 4 * 1024 * 1024;
  function makeServer() {
    const payload = new Uint8Array(SIZE);
    for (let i = 0; i < SIZE; i++) payload[i] = (i * 19) & 0xff;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/chunked") {
          return new Response(
            new ReadableStream({
              async pull(c) {
                for (let o = 0; o < SIZE; o += 65536) {
                  c.enqueue(payload.subarray(o, o + 65536));
                  if (o % (1024 * 1024) === 0) await Bun.sleep(1);
                }
                c.close();
              },
            }),
          );
        }
        return new Response(payload);
      },
    });
    return { server, payload };
  }

  for (const path of ["/", "/chunked"]) {
    it(`writes the body bytes and resolves with the count (${path === "/" ? "sized" : "chunked"})`, async () => {
      const { server, payload } = makeServer();
      using _s = server;
      using dir = tempDir("bun-write-stream", {});
      const dest = join(String(dir), "body.bin");

      const res = await fetch(`${server.url.origin}${path}`);
      const n = await Bun.write(dest, res);

      expect(n).toBe(SIZE);
      const got = await Bun.file(dest).bytes();
      expect(got.byteLength).toBe(SIZE);
      expect(Buffer.compare(got, payload)).toBe(0);
    });
  }

  it("creates missing parent directories by default and honors createPath: false", async () => {
    const { server } = makeServer();
    using _s = server;
    using dir = tempDir("bun-write-createpath", {});

    const res = await fetch(server.url);
    const n = await Bun.write(join(String(dir), "deep", "nested", "out.bin"), res);
    expect(n).toBe(SIZE);

    const res2 = await fetch(server.url);
    expect(async () => {
      await Bun.write(join(String(dir), "missing", "out.bin"), res2, { createPath: false });
    }).toThrow();
  });

  it("memory stays bounded by the high-water mark, not the body size", async () => {
    // 64MB body; the buffered implementation grows RSS by >= the body size
    // (measured 5x), the streaming path by a fraction of it.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const SIZE = 64 * 1024 * 1024;
        const CHUNK = 1024 * 1024;
        const chunk = new Uint8Array(CHUNK).fill(0x42);
        using server = Bun.serve({
          port: 0,
          fetch() {
            let sent = 0;
            return new Response(new ReadableStream({
              async pull(c) {
                while (sent < SIZE) {
                  c.enqueue(chunk);
                  sent += CHUNK;
                  if (sent % (16 * CHUNK) === 0) await Bun.sleep(0);
                }
                c.close();
              },
            }));
          },
        });
        const dest = require("node:path").join(require("node:os").tmpdir(), "bun-write-stream-rss-" + process.pid + ".bin");
        Bun.gc(true);
        const rss0 = process.memoryUsage.rss();
        const res = await fetch(server.url);
        const n = await Bun.write(dest, res);
        const deltaMB = Math.round((process.memoryUsage.rss() - rss0) / 1048576);
        require("node:fs").rmSync(dest, { force: true });
        console.log(JSON.stringify({ n, deltaMB }));
        `,
      ],
      env: {
        ...bunEnv,
        // ASAN's quarantine retains freed allocations (256MB default), which
        // would dominate the RSS delta on sanitizer builds; pin it small.
        // Non-ASAN builds ignore this.
        ASAN_OPTIONS: "quarantine_size_mb=16",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const { n, deltaMB } = JSON.parse(stdout.trim().split("\n").at(-1));
    expect(n).toBe(64 * 1024 * 1024);
    // buffered: delta >= body size (64MB, measured ~5x); streaming: a fraction
    expect(deltaMB).toBeLessThan(48);
    expect(exitCode).toBe(0);
  });
});
