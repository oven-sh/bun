import fs from "fs";
import { it, expect, describe } from "bun:test";
import path from "path";
import { gcTick, withoutAggressiveGC, bunExe } from "harness";
import { tmpdir } from "os";

it("Bun.write blob", async () => {
  await Bun.write(Bun.file("/tmp/response-file.test.txt"), Bun.file(path.join(import.meta.dir, "fetch.js.txt")));
  await gcTick();
  await Bun.write(Bun.file("/tmp/response-file.test.txt"), "blah blah blha");
  await gcTick();
  await Bun.write(Bun.file("/tmp/response-file.test.txt"), new Uint32Array(1024));
  await gcTick();
  await Bun.write("/tmp/response-file.test.txt", new Uint32Array(1024));
  await gcTick();
  expect(await Bun.write(new TextEncoder().encode("/tmp/response-file.test.txt"), new Uint32Array(1024))).toBe(
    new Uint32Array(1024).byteLength,
  );
  await gcTick();
});

describe("large file", () => {
  const fixtures = [
    [
      `/tmp/bun-test-large-file-${Date.now()}.txt`,
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
    await Bun.file("/does/not/exist.txt").text();
    await gcTick();
  } catch (exception) {
    expect(exception.code).toBe("ENOENT");
  }
  await gcTick();
});

it("Bun.write('out.txt', 'string')", async () => {
  for (let erase of [true, false]) {
    if (erase) {
      try {
        fs.unlinkSync(path.join("/tmp", "out.txt"));
      } catch (e) {}
    }
    await gcTick();
    expect(await Bun.write("/tmp/out.txt", "string")).toBe("string".length);
    await gcTick();
    const out = Bun.file("/tmp/out.txt");
    await gcTick();
    expect(await out.text()).toBe("string");
    await gcTick();
    expect(await out.text()).toBe(fs.readFileSync("/tmp/out.txt", "utf8"));
    await gcTick();
  }
});

it("Bun.file -> Bun.file", async () => {
  try {
    fs.unlinkSync(path.join("/tmp", "fetch.js.in"));
  } catch (e) {}
  await gcTick();
  try {
    fs.unlinkSync(path.join("/tmp", "fetch.js.out"));
  } catch (e) {}
  await gcTick();
  const file = path.join(import.meta.dir, "fetch.js.txt");
  await gcTick();
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync("/tmp/fetch.js.in", text);
  await gcTick();
  {
    const result = await Bun.write(Bun.file("/tmp/fetch.js.out"), Bun.file("/tmp/fetch.js.in"));
    await gcTick();
    expect(await Bun.file("/tmp/fetch.js.out").text()).toBe(text);
    await gcTick();
  }

  {
    await Bun.write(Bun.file("/tmp/fetch.js.in").slice(0, (text.length / 2) | 0), Bun.file("/tmp/fetch.js.out"));
    expect(await Bun.file("/tmp/fetch.js.in").text()).toBe(text.substring(0, (text.length / 2) | 0));
  }

  {
    await gcTick();
    await Bun.write("/tmp/fetch.js.in", Bun.file("/tmp/fetch.js.out"));
    await gcTick();
    expect(await Bun.file("/tmp/fetch.js.in").text()).toBe(text);
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
  await Bun.sleep(10);
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
    fs.unlinkSync("/tmp/fetch.js.out");
  } catch {}
  await gcTick();
  const file = path.join(import.meta.dir, "fetch.js.txt");
  await gcTick();
  const text = fs.readFileSync(file, "utf8");
  await gcTick();
  const resp = await fetch("https://example.com");
  await gcTick();

  expect(await Bun.write("/tmp/fetch.js.out", resp)).toBe(text.length);
  await gcTick();
  expect(await Bun.file("/tmp/fetch.js.out").text()).toBe(text);
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
  await Bun.write("/tmp/output.html", "lalalala");
  expect(await Bun.write("/tmp/output.html", "")).toBe(0);
  await Bun.write("/tmp/output.html", "lalalala");
  expect(await Bun.file("/tmp/output.html").text()).toBe("lalalala");
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
it.skip("Bun.write('output.html', HTMLRewriter.transform(Bun.file)))", async done => {
  var rewriter = new HTMLRewriter();

  rewriter.on("div", {
    element(element) {
      element.setInnerContent("<blink>it worked!</blink>", { html: true });
    },
  });
  await Bun.write("/tmp/html-rewriter.txt.js", "<div>hello</div>");
  var input = new Response(Bun.file("/tmp/html-rewriter.txt.js"));
  var output = rewriter.transform(input);
  const outpath = `/tmp/html-rewriter.${Date.now()}.html`;
  await Bun.write(outpath, output);
  expect(await Bun.file(outpath).text()).toBe("<div><blink>it worked!</blink></div>");
  done();
});

it("#2674", async () => {
  const file = path.join(import.meta.dir, "big-stdout.js");

  const { stderr, stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", file],
    stderr: "pipe",
    stdout: "pipe",
  });
  console.log(stderr?.toString());
  const text = stdout?.toString();
  expect(text?.length).toBeGreaterThanOrEqual(300000);
  const error = stderr?.toString();
  expect(error?.length).toBeFalsy();
  expect(exitCode).toBe(0);
});
