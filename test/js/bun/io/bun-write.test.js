import fs, { mkdirSync } from "fs";
import { it, expect, describe } from "bun:test";
import path, { join } from "path";
import { gcTick, withoutAggressiveGC, bunExe, bunEnv } from "harness";
import { tmpdir } from "os";
const tmpbase = tmpdir() + path.sep;

it("Bun.write blob", async () => {
  await Bun.write(
    Bun.file(join(tmpdir(), "response-file.test.txt")),
    Bun.file(path.resolve(import.meta.dir, "fetch.js.txt")),
  );
  await gcTick();
  await Bun.write(Bun.file(join(tmpdir(), "response-file.test.txt")), "blah blah blha");
  await gcTick();
  await Bun.write(Bun.file(join(tmpdir(), "response-file.test.txt")), new Uint32Array(1024));
  await gcTick();
  await Bun.write(join(tmpdir(), "response-file.test.txt"), new Uint32Array(1024));
  await gcTick();
  expect(await Bun.write(new TextEncoder().encode(tmpbase + "response-file.test.txt"), new Uint32Array(1024))).toBe(
    new Uint32Array(1024).byteLength,
  );
  await gcTick();
});

describe("large file", () => {
  const fixtures = [
    [
      tmpbase + `bun-test-large-file-${Date.now()}.txt`,
      "https://www.iana.org/assignments/media-types/media-types.xhtml,".repeat(10000),
    ],
  ];

  for (const [filename, content] of fixtures) {
    it(`write ${filename} ${content.length} (text)`, async () => {
      try {
        unlinkSync(filename);
      } catch (e) {}
      await Bun.write(filename, content);
      expect(await Bun.file(filename).text()).toBe(content);

      try {
        unlinkSync(filename);
      } catch (e) {}
    });

    it(`write ${filename}.bytes ${content.length} (bytes)`, async () => {
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

    it(`write ${filename}.blob ${content.length} (Blob)`, async () => {
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
  }
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
  const dst = Bun.file(path.join(tmpdir(), join("does", "not", "exist.txt")));
  fs.rmSync(join(tmpdir(), "does"), { force: true, recursive: true });

  try {
    await gcTick();
    await Bun.write(dst, "", { createPath: false });
    await gcTick();
    expect.unreachable();
  } catch (exception) {
    expect(exception.code).toBe("ENOENT");
    expect(exception.path).toBe(dst.name);
  }

  const src = Bun.file(path.join(tmpdir(), `test-bun-write-${Date.now()}.txt`));

  await Bun.write(src, "");
  try {
    await gcTick();
    await Bun.write(dst, src, { createPath: false });
    await gcTick();
  } catch (exception) {
    expect(exception.code).toBe("ENOENT");
    expect(exception.path).toBe(dst.name);
  } finally {
    fs.unlinkSync(src.name);
  }
});

it("Bun.write('out.txt', 'string')", async () => {
  const outpath = path.join(tmpdir(), "out." + ((Math.random() * 102400) | 0).toString(32) + "txt");
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
  try {
    fs.unlinkSync(path.join(tmpdir(), "fetch.js.in"));
  } catch (e) {}
  await gcTick();
  try {
    fs.unlinkSync(path.join(tmpdir(), "fetch.js.out"));
  } catch (e) {}
  await gcTick();

  const file = path.join(import.meta.dir, "fetch.js.txt");
  await gcTick();
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(tmpbase + "fetch.js.in", text);
  await gcTick();
  {
    const result = await Bun.write(Bun.file(tmpbase + "fetch.js.out"), Bun.file(tmpbase + "fetch.js.in"));
    await gcTick();
    expect(await Bun.file(tmpbase + "fetch.js.out").text()).toBe(text);
    await gcTick();
  }

  {
    await Bun.write(
      Bun.file(tmpbase + "fetch.js.in").slice(0, (text.length / 2) | 0),
      Bun.file(tmpbase + "fetch.js.out"),
    );
    expect(await Bun.file(tmpbase + "fetch.js.in").text()).toBe(text.substring(0, (text.length / 2) | 0));
  }

  {
    await gcTick();
    await Bun.write(tmpbase + "fetch.js.in", Bun.file(tmpbase + "fetch.js.out"));
    await gcTick();
    expect(await Bun.file(tmpbase + "fetch.js.in").text()).toBe(text);
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
  const file = Bun.file(tmpdir() + "/bun.test.lastModified.txt");
  await gcTick();
  // setup
  await Bun.write(file, "test text.");
  const lastModified0 = file.lastModified;

  // sleep some time and write the file again.
  await Bun.sleep(process.platform === "win32" ? 1000 : 100);
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
  // ensure the file doesn't already exist
  try {
    fs.unlinkSync(tmpbase + "fetch.js.out");
  } catch {}
  await gcTick();
  const file = path.join(import.meta.dir, "fetch.js.txt");
  await gcTick();
  const text = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  await gcTick();
  const resp = await fetch("https://example.com");
  await gcTick();
  await gcTick();
  expect(await Bun.write(tmpbase + "fetch.js.out", resp)).toBe(text.length);
  expect(await Bun.file(tmpbase + "fetch.js.out").text()).toBe(text);
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

// FLAKY TEST
// Since Bun.file is resolved lazily, this needs to specifically be checked
it("Bun.write('output.html', HTMLRewriter.transform(Bun.file)))", async done => {
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
  const filename = tmpdir() + "/bun.test.offset2.txt";
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
      var tempdir = `${tmpdir()}/fs.test.js/${Date.now()}-1/bun-write/large`;
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
      const tempdir = `${tmpdir()}/fs.test.js/${Date.now()}-1/bun-write/small`;
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
      const dir = `${tmpdir()}/fs.test.js/${Date.now()}-1/bun-write/ENOENT`;
      const file = join(dir, "file");
      try {
        await Bun.write(file, "contents", ...opts);
        expect(fs.existsSync(file)).toBe(true);
      } finally {
        fs.rmSync(dir, { force: true });
      }
    });
  };

  describe("by default", () => creates());
  describe("with { createPath: true }", () => {
    creates({ createPath: true });
  });

  describe("with { createPath: false }", () => {
    it("does not create the directory", async () => {
      const dir = `${tmpdir()}/fs.test.js/${performance.now()}-1/bun-write/ENOENT`;
      const file = join(dir, "file");
      try {
        expect(async () => await Bun.write(file, "contents", { createPath: false })).toThrow(
          "No such file or directory",
        );
        expect(fs.existsSync(file)).toBe(false);
      } finally {
        fs.rmSync(dir, { force: true });
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
