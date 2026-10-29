// HTML tests are tests relating to HTML files themselves.
import { expect } from "bun:test";
import { isLinux } from "harness";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Client, type Dev, devTest, emptyHtmlFile } from "../bake-harness";

devTest("html file is watched", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Hello</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("<h1>Hello</h1>");
    await dev.fetch("/").expect.toInclude("<h1>Hello</h1>");
    await dev.patch("index.html", {
      find: "Hello",
      replace: "World",
    });
    await dev.fetch("/").expect.toInclude("<h1>World</h1>");

    // Works
    await using c = await dev.client("/");
    await c.expectMessage("hello");

    // Editing HTML reloads
    await c.expectReload(async () => {
      await dev.patch("index.html", {
        find: "World",
        replace: "Hello",
      });
      await dev.fetch("/").expect.toInclude("<h1>Hello</h1>");
    });
    await c.expectMessage("hello");

    await c.expectReload(async () => {
      await dev.patch("index.html", {
        find: "Hello",
        replace: "Bar",
      });
      await dev.fetch("/").expect.toInclude("<h1>Bar</h1>");
    });
    await c.expectMessage("hello");

    await c.expectReload(async () => {
      await dev.patch("script.ts", {
        find: "hello",
        replace: "world",
      });
    });
    await c.expectMessage("world");
  },
});

devTest("image tag", {
  files: {
    "index.html": `
      <!DOCTYPE html><html><head></head><body>
      <img src="image.png" alt="test image">
      </body></html>
    `,
    "image.png": "FIRST",
  },
  async test(dev) {
    await using c = await dev.client("/");

    const url: string = await c.js`document.querySelector("img").src`;
    expect(url).toBeString(); // image tag exists
    await dev.fetch(url).expect.toBe("FIRST");

    // Editing HTML causes reload but image still works
    await c.expectReload(async () => {
      await dev.patch("index.html", {
        find: 'alt="test image"',
        replace: 'alt="modified image"',
      });
      await dev.fetch("/").expect.toInclude('alt="modified image"');
    });
    // The image did not change, so the reloaded page keeps its URL and the asset is still served.
    expect(await c.js`document.querySelector("img").src`).toBe(url);
    await dev.fetch(url).expect.toBe("FIRST");

    // Editing image content causes a hard reload because the html must reflect the new image content
    await c.expectReload(async () => {
      await dev.patch("image.png", {
        find: "FIRST",
        replace: "SECOND",
      });
    });

    const url2 = await c.js`document.querySelector("img").src`;
    expect(url).not.toBe(url2);
    await dev.fetch(url2).expect.toBe("SECOND");

    await dev.fetch(url).expect404(); // TODO
  },
});
devTest("image import in JS", {
  files: {
    "index.html": `
      <!DOCTYPE html><html><head></head><body>
      <script type="module" src="script.ts"></script>
      </body></html>
    `,
    "script.ts": `
      import img from "./image.png";
      console.log(img);
    `,
    "image.png": "FIRST",
  },
  async test(dev) {
    await using c = await dev.client("/");

    const img1 = await c.getStringMessage();
    await dev.fetch(img1).expect.toBe("FIRST");

    // Editing image content updates the image URL
    await c.expectReload(async () => {
      await dev.patch("image.png", {
        find: "FIRST",
        replace: "SECOND",
      });
    });

    const img2 = await c.getStringMessage();
    await dev.fetch(img2).expect.toBe("SECOND");
    // await dev.fetch(img1).expect404();
  },
});
devTest("html references a json file that is cached as a module", {
  files: {
    "index.html": `
      <!DOCTYPE html><html><head></head><body>
      <script type="module" src="script.ts"></script>
      </body></html>
    `,
    "script.ts": `
      import manifest from "./manifest.json";
      console.log(manifest.name);
    `,
    "manifest.json": `{ "name": "app" }`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("app");

    await c.expectReload(async () => {
      await dev.patch("index.html", {
        find: "<head></head>",
        replace: '<head><link rel="manifest" href="./manifest.json"></head>',
      });
    });
    await c.expectMessage("app");

    // The dev server can only treat a file as one kind of module, so it serves the page without the link.
    const html = await (await dev.fetch("/")).text();
    expect(html).toInclude("<script");
    expect(html).not.toInclude('rel="manifest"');
  },
});
devTest("import then create", {
  files: {
    "index.html": `
      <!DOCTYPE html>
      <html>
      <head></head>
      <body>
        <script type="module" src="/script.ts"></script>
      </body>
      </html>
    `,
    "script.ts": `
      import data from "./data";
      console.log(data);
    `,
  },
  async test(dev) {
    const c = await dev.client("/", {
      errors: ['script.ts:1:18: error: Could not resolve: "./data"'],
    });
    await c.expectReload(async () => {
      await dev.write("data.ts", "export default 'data';");
    });
    await c.expectMessage("data");
  },
});
devTest("a file whose import failed to resolve is imported by a second file", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/entry.ts"],
    }),
    "entry.ts": `
      import "./broken";
      import "./first";
    `,
    "broken.ts": `
      import "not-installed-pkg";
      export const value = "value";
    `,
    // broken.ts has failed by the time the bundler gets to its second importer.
    "first.ts": `
      import "./second";
    `,
    "second.ts": `
      import "./third";
    `,
    "third.ts": `
      import { value } from "./broken";
      console.log(value);
    `,
  },
  async test(dev) {
    const c = await dev.client("/", {
      errors: ['broken.ts:1:8: error: Could not resolve: "not-installed-pkg". Maybe you need to "bun install"?'],
    });
    await c.expectReload(async () => {
      await dev.write("broken.ts", `export const value = "value";`);
    });
    await c.expectMessage("value");
  },
});
devTest("reports a bunBakeGraph import in a client script, then runs the script once it's fixed", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import value from "./other.ts" with { bunBakeGraph: "ssr" };
      console.log(value);
    `,
    "other.ts": `
      export default "other";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["index.ts:1:19: error: Framework does not have a separate SSR graph to put this import into"],
    });
    await c.expectReload(async () => {
      await dev.write("index.ts", `console.log("repaired");`);
    });
    await c.expectMessage("repaired");
  },
});
devTest("external links", {
  files: {
    "index.html": `
      <!doctype html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>index | Powered by Bun</title>
        <link rel="stylesheet" href="./index.css" />
        <link rel="icon" type="image/x-icon" href="https://bun.sh/favicon.ico" />
      </head>
      <body>
        <div id="root"></div>
        <script src="./index.client.tsx" type="module"></script>
      </body>
      </html>
    `,
    "index.css": `
      body {
        background-color: red;
      }
    `,
    "index.client.tsx": `
      console.log("hello");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello");

    const ico: string = await c.js`document.querySelector("link[rel='icon']").href`;
    expect(ico).toBe("https://bun.sh/favicon.ico");
  },
});
devTest("memory leak case 1", {
  files: {
    "index.html": `
      <script type="module" src="/script.ts"></script>
    `,
    "script.ts": `
      import data from "./data";
    `,
  },
  async test(dev) {
    await dev.fetch("/"); // previously leaked source map
  },
});

devTest("chrome devtools automatic workspace folders", {
  files: {
    "index.html": `
      <script type="module" src="/script.ts"></script>
    `,
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/.well-known/appspecific/com.chrome.devtools.json");
    expect(response.status).toBe(200);
    const json = await response.json();
    const root = dev.join(".");
    expect(json).toMatchObject({
      workspace: {
        root,
        uuid: expect.any(String),
      },
    });
  },
});

devTest("error report endpoint handles stack frames with very long absolute paths", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Error Report</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    // Wire format of POST /_bun/report_error (length-prefixed binary):
    //   string32 error name, string32 message, string32 browser url,
    //   u32 frame count, then per frame: i32 line, i32 column,
    //   string32 function name, string32 file name.
    function u32(n: number) {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n >>> 0, 0);
      return b;
    }
    function i32(n: number) {
      const b = Buffer.alloc(4);
      b.writeInt32LE(n, 0);
      return b;
    }
    function str32(s: string) {
      const bytes = Buffer.from(s, "utf8");
      return Buffer.concat([u32(bytes.length), bytes]);
    }
    function frame(line: number, column: number, functionName: string, fileName: string) {
      return Buffer.concat([i32(line), i32(column), str32(functionName), str32(fileName)]);
    }

    // One ordinary frame pointing at a real project file, plus one frame whose
    // absolute path is far larger than any platform path buffer (16 KiB).
    const normalPath = dev.join("script.ts");
    const oversizedPath = "/" + "A/".repeat(8192);
    const body = Buffer.concat([
      str32("Error"), // error name
      str32("test message"), // error message
      str32(dev.baseUrl + "/"), // browser url
      u32(2), // stack frame count
      frame(1, 1, "first", normalPath),
      frame(1, 1, "second", oversizedPath),
    ]);

    const res = await dev.fetch("/_bun/report_error", { method: "POST", body });
    expect(res.status).toBe(200);
    // The reply still references the legitimate frame's file.
    const text = await res.text();
    expect(text).toContain("script.ts");

    // The dev server must still be serving requests afterwards.
    await dev.fetch("/").expect.toInclude("<h1>Error Report</h1>");
  },
});

devTest("error report endpoint rejects requests whose origin header does not match the dev server", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Origin Check</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    function u32(n: number) {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n >>> 0, 0);
      return b;
    }
    function str32(s: string) {
      const bytes = Buffer.from(s, "utf8");
      return Buffer.concat([u32(bytes.length), bytes]);
    }
    const body = Buffer.concat([str32("Error"), str32("origin-check-message"), str32(dev.baseUrl + "/"), u32(0)]);

    const crossOrigin = await dev.fetch("/_bun/report_error", {
      method: "POST",
      headers: { Origin: "http://other-page.example" },
      body,
    });
    expect(await crossOrigin.text()).toBe("Blocked: Origin header does not match the dev server");
    expect(crossOrigin.status).toBe(403);

    const sameOrigin = await dev.fetch("/_bun/report_error", {
      method: "POST",
      headers: { Origin: dev.baseUrl },
      body,
    });
    expect(sameOrigin.status).toBe(200);

    await dev.fetch("/").expect.toInclude("<h1>Origin Check</h1>");
  },
});

devTest("error report endpoint blanks stray non-text bytes in reported frames", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Frame Bytes</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    function u32(n: number) {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n >>> 0, 0);
      return b;
    }
    function i32(n: number) {
      const b = Buffer.alloc(4);
      b.writeInt32LE(n, 0);
      return b;
    }
    function bytes32(bytes: Buffer) {
      return Buffer.concat([u32(bytes.length), bytes]);
    }
    function str32(s: string) {
      return bytes32(Buffer.from(s, "utf8"));
    }

    const functionName = Buffer.concat([Buffer.from("fnstart"), Buffer.from([0x9b]), Buffer.from("fnend")]);
    const body = Buffer.concat([
      str32("Error"),
      str32("frame-bytes-message"),
      str32(dev.baseUrl + "/"),
      u32(1),
      i32(1),
      i32(1),
      bytes32(functionName),
      str32("foo.ts"),
    ]);

    const res = await dev.fetch("/_bun/report_error", { method: "POST", body });
    const reply = Buffer.from(await res.arrayBuffer());
    expect(reply.includes(Buffer.from("fnstart fnend", "latin1"))).toBe(true);
    expect(reply.includes(0x9b)).toBe(false);
    expect(res.status).toBe(200);

    await dev.fetch("/").expect.toInclude("<h1>Frame Bytes</h1>");
  },
});
devTest("client script route returns 404 when the route bundle index is out of range", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["/script.ts"] }),
    "script.ts": `console.log("client-script-marker");`,
  },
  async test(dev) {
    // `/_bun/client/{name}-{index}{generation}.js`, where each hex group encodes a u32's four bytes.
    const page = await dev.fetch("/").text();
    const [script, generation] = page.match(/\/_bun\/client\/index-[0-9a-f]{8}([0-9a-f]{8})\.js/) ?? [];
    await dev.fetch(script).expect.toInclude("client-script-marker");

    await dev.fetch(`/_bun/client/index-ffffffff${generation}.js`).expect404();
    await dev.fetch(`/_bun/client/index-feffffff${generation}.js`).expect404();
    await dev.fetch(script).expect.toInclude("client-script-marker");
  },
});

devTest("editing a file imported from outside the project root hot-reloads", {
  // The Windows watcher does not watch files outside the project directory.
  skip: ["win32"],
  files: {
    "web/index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "web/index.ts": `
      import { value } from "../outside/dep";
      console.log(value);
      import.meta.hot.accept();
    `,
    "outside/dep.ts": `
      export const value = "one";
    `,
  },
  cwd: "web",
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("one");
    await dev.write(
      "outside/dep.ts",
      `
        export const value = "two";
      `,
    );
    await c.expectMessage("two");
    await dev.write(
      "outside/dep.ts",
      `
        export const value = "three";
      `,
    );
    await c.expectMessage("three");
  },
});

const filesWithDepBesideWeb = {
  "web/index.html": emptyHtmlFile({
    scripts: ["index.ts"],
  }),
  "web/index.ts": `
    import { value } from "../outside/dep";
    console.log(value);
    import.meta.hot.accept();
  `,
  "outside/dep.ts": `
    export const value = "one";
  `,
};

// A failed import makes the dev server watch the directory of the missing file. The dev server
// releases that watch when the import resolves. This fails an import of `missing`, then resolves
// it. In between it saves outside/dep.ts the way vim does: rename the file away, write a new one.
// The watcher then removes the watch item of the old file and moves its last item into that slot.
// `importer` is the name of web/index.ts in an error message.
async function resolveFailedImportAfterRenameSave(dev: Dev, c: Client, missing: string, importer = "index.ts") {
  const errors = [`${importer}:2:8: error: Could not resolve: ${JSON.stringify(missing)}`];
  await dev.write(
    "web/index.ts",
    `
      import { value } from "../outside/dep";
      import ${JSON.stringify(missing)};
      console.log(value);
      import.meta.hot.accept();
    `,
    { errors },
  );
  {
    await using _ = await dev.batchChanges({ errors });
    renameSync(dev.join("outside/dep.ts"), dev.join("outside/dep.ts~"));
    writeFileSync(dev.join("outside/dep.ts"), `export const value = "two";`);
  }
  await c.expectMessage("two");

  await dev.write(path.join("web", missing + ".ts"), `export {};`);
  await c.expectMessage("two");

  // The watcher removes a released watch item after its next batch of events.
  await dev.patch("web/index.ts", { find: "console.log(value)", replace: `console.log(value + "!")` });
  await c.expectMessage("two!");
}

// The watcher trace names the watch item of each event. This returns the items of the events
// after `offset`, as paths relative to the test root.
function watchItemsSince(dev: Dev, trace: string, offset: number) {
  return readFileSync(trace)
    .subarray(offset)
    .toString()
    .split("\n")
    .filter(line => line.length > 0)
    .flatMap(line => Object.keys(JSON.parse(line).files))
    .map(item => (existsSync(item) ? path.relative(dev.rootDir, realpathSync(item)) : item));
}

// The dev server kept the position of the directory watch in the watcher's list. After the rename
// save that position named the new outside/dep.ts, and the release removed that watch item. On
// Linux a directory in the project root has a watch item that also reports a save of its files, so
// the file is outside the root.
devTest("resolving a failed import keeps the watch of a file that was saved by rename", {
  // The Windows watcher does not watch files outside the project directory.
  skip: ["win32"],
  files: filesWithDepBesideWeb,
  cwd: "web",
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("one");
    await resolveFailedImportAfterRenameSave(dev, c, "./later");

    await dev.write("outside/dep.ts", `export const value = "three";`);
    await c.expectMessage("three!");
  },
});

// The same with outside/ in the project root. macOS and Windows report a save only through the
// watch item of the file. On Linux the watch item of outside/ reports it too, so the hot update
// arrives either way, and the trace shows whether the item of the file reported.
devTest("resolving a failed import keeps the watch of a file in the project root", {
  files: filesWithDepBesideWeb,
  // Relative to the test root. A trace file in a watched directory reports its own writes.
  env: { BUN_WATCHER_TRACE: "../watcher-trace-in-root.log" },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("one");
    await resolveFailedImportAfterRenameSave(dev, c, "./later", "web/index.ts");

    const trace = dev.join("../watcher-trace-in-root.log");
    const saved = isLinux ? readFileSync(trace).length : 0;
    await dev.write("outside/dep.ts", `export const value = "three";`);
    await c.expectMessage("three!");
    if (isLinux) expect(watchItemsSince(dev, trace, saved)).toContain("outside/dep.ts");
  },
});

// The same order of events left the watch item of the directory in the watcher. outside/ is not
// in the project root, so only the watch for the failed import reports a new file in it.
devTest("resolving a failed import releases the watch of its directory", {
  // The Windows watcher does not watch files outside the project directory.
  skip: ["win32"],
  files: filesWithDepBesideWeb,
  cwd: "web",
  // Relative to web/. A trace file in a watched directory reports its own writes.
  env: { BUN_WATCHER_TRACE: "../watcher-trace.log" },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("one");
    await resolveFailedImportAfterRenameSave(dev, c, "../outside/later");

    const trace = dev.join("watcher-trace.log");
    const released = readFileSync(trace).length;
    writeFileSync(dev.join("outside/unrelated.txt"), "");
    await dev.patch("web/index.ts", { find: `"!"`, replace: `"?"` });
    await c.expectMessage("two?");

    const items = watchItemsSince(dev, trace, released);
    expect(items).toContain("web/index.ts");
    expect(items).not.toContain("outside");
  },
});

// The watcher removes a released watch item after its next batch of events. A failed import in the
// same directory before that batch took the item that was about to go, and then nothing reported
// the file that resolves the import.
devTest("a failed import is retried when the watch of its directory was released just before", {
  // The Windows watcher does not watch files outside the project directory.
  skip: ["win32"],
  files: {
    "web/index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "web/index.ts": `
      import { a } from "../outside/a";
      console.log(a);
    `,
    "staged/a.ts": `
      import { b } from "./b";
      export const a = "a" + b;
    `,
  },
  cwd: "web",
  async test(dev) {
    // The dev server watches a directory only if it exists.
    dev.mkdir("outside");
    await using c = await dev.client("/", {
      errors: [`index.ts:1:19: error: Could not resolve: "../outside/a"`],
    });

    // One rename is one watcher event: no later batch removes the released item before the
    // rebuild fails on "./b".
    const errors = [`../outside/a.ts:1:19: error: Could not resolve: "./b"`];
    {
      await using _ = await dev.batchChanges({ errors });
      renameSync(dev.join("staged/a.ts"), dev.join("outside/a.ts"));
    }
    // This save is the next batch of events.
    await dev.patch("web/index.ts", { find: "console.log(a)", replace: "console.log(a + '!')", errors });

    await c.expectReload(async () => {
      await dev.write("outside/b.ts", `export const b = "b";`);
    });
    await c.expectMessage("ab!");
  },
});

// Two directory watches are released in one hot reload, dir-a first. The rebuild fails a new
// import in dir-a. That keeps the watch of dir-a, and the watch of dir-b still goes.
devTest("a failed import keeps its directory watch and not another released watch", {
  // The Windows watcher does not watch files outside the project directory.
  skip: ["win32"],
  files: {
    "web/index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "web/index.ts": `
      import { a } from "../dir-a/a";
      import { b } from "../dir-b/b";
      console.log(a + b);
    `,
    "staged/a.ts": `
      import { next } from "./next";
      export const a = "a" + next;
    `,
    "staged/b.ts": `
      export const b = "b";
    `,
  },
  cwd: "web",
  // Relative to web/. A trace file in a watched directory reports its own writes.
  env: { BUN_WATCHER_TRACE: "../watcher-trace.log" },
  async test(dev) {
    // The dev server watches a directory only if it exists.
    dev.mkdir("dir-a");
    dev.mkdir("dir-b");
    await using c = await dev.client("/", {
      errors: [
        `index.ts:1:19: error: Could not resolve: "../dir-a/a"`,
        `index.ts:2:19: error: Could not resolve: "../dir-b/b"`,
      ],
    });

    const errors = [`../dir-a/a.ts:1:22: error: Could not resolve: "./next"`];
    {
      await using _ = await dev.batchChanges({ errors });
      renameSync(dev.join("staged/a.ts"), dev.join("dir-a/a.ts"));
      renameSync(dev.join("staged/b.ts"), dev.join("dir-b/b.ts"));
    }
    // This save is the next batch of events.
    await dev.patch("web/index.ts", { find: "console.log(a + b)", replace: "console.log(a + b + '!')", errors });

    const trace = dev.join("watcher-trace.log");
    const released = readFileSync(trace).length;
    writeFileSync(dev.join("dir-b/unrelated.txt"), "");
    await c.expectReload(async () => {
      await dev.write("dir-a/next.ts", `export const next = "n";`);
    });
    await c.expectMessage("anb!");

    const items = watchItemsSince(dev, trace, released);
    expect(items).toContain("dir-a");
    expect(items).not.toContain("dir-b");
  },
});
