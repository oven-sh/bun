// HTML tests are tests relating to HTML files themselves.
//
// Every devTest boots a dev server, usually a happy-dom client too, and waits
// for the server to exit. That is most of a case's time, so cases that start
// from the same project are one sequence of steps on one server.
import { expect } from "bun:test";
import { isWindows } from "harness";
import { Dev, devTest, emptyHtmlFile } from "../bake-harness";

/** The one module script the dev server injects into every page. */
const BUNDLE_URL = /^\/_bun\/client\/index-[0-9a-f]{16}\.js$/;
/** A hashed asset URL. The hash changes with the content. */
function assetUrl(extension: string) {
  return new RegExp(`^/_bun/asset/[0-9a-f]{16}\\.${extension}$`);
}

/**
 * Fetches a page. The bundler drops the page's own `<script>` and
 * `<link rel="stylesheet">` tags, and the dev server injects, right before
 * `</head>`: one `<link>` per stylesheet the page imports, the page's bundle as
 * one module script, and an inline snippet. Returns the injected URLs and the
 * rest of the document, with the whitespace between tags collapsed so the
 * expected document fits on one line.
 */
async function fetchPage(dev: Dev, url = "/") {
  const res = await dev.fetch(url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/html;charset=utf-8");
  const html = await res.text();
  const injected = html.match(
    /((?:<link rel="stylesheet" href="[^"]+">)*)<script type="module" crossorigin src="([^"]+)" data-bun-dev-server-script><\/script><script>[^<]*<\/script>(?=<\/head>)/,
  );
  if (!injected) throw new Error("The dev server did not inject its script tag before </head>:\n" + html);
  return {
    html: html.replace(injected[0], "").replace(/\s+/g, " ").replaceAll("> <", "><").trim(),
    styles: Array.from(injected[1].matchAll(/href="([^"]+)"/g), m => m[1]),
    script: injected[2],
  };
}

/** Fetches an asset and asserts its status and content type. Returns the body as text. */
async function fetchAsset(dev: Dev, url: string, contentType: string) {
  const res = await dev.fetch(url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe(contentType);
  return res.text();
}

// Wire format of POST /_bun/report_error (little-endian, length-prefixed):
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
function bytes32(bytes: Buffer) {
  return Buffer.concat([u32(bytes.length), bytes]);
}
function str32(s: string) {
  return bytes32(Buffer.from(s, "utf8"));
}
function frame(line: number, column: number, functionName: string | Buffer, fileName: string) {
  return Buffer.concat([
    i32(line),
    i32(column),
    typeof functionName === "string" ? str32(functionName) : bytes32(functionName),
    str32(fileName),
  ]);
}

async function postErrorReport(dev: Dev, message: string, frames: Buffer[], headers?: Record<string, string>) {
  const body = Buffer.concat([str32("Error"), str32(message), str32(dev.baseUrl + "/"), u32(frames.length), ...frames]);
  const res = await dev.fetch("/_bun/report_error", { method: "POST", headers, body });
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    reply: Buffer.from(await res.arrayBuffer()),
  };
}

/**
 * Decodes the reply: u32 frame count, then per frame i32 line, i32 column,
 * string32 function name, string32 file name (relative to the project root when
 * it is inside it), then a u8 count of source context lines, which is 0 unless
 * a frame was remapped through a source map.
 */
function decodeReport(reply: Buffer) {
  let pos = 0;
  const readU32 = () => {
    const n = reply.readUInt32LE(pos);
    pos += 4;
    return n;
  };
  const readI32 = () => {
    const n = reply.readInt32LE(pos);
    pos += 4;
    return n;
  };
  const readStr32 = () => {
    const len = readU32();
    const s = reply.toString("utf8", pos, pos + len);
    pos += len;
    return s;
  };
  const frames: { line: number; column: number; functionName: string; fileName: string }[] = [];
  for (let n = readU32(); n > 0; n--) {
    frames.push({ line: readI32(), column: readI32(), functionName: readStr32(), fileName: readStr32() });
  }
  const contextLines = reply.readUInt8(pos++);
  expect(pos).toBe(reply.length);
  return { frames, contextLines };
}

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
    const page = (body: string) => ({
      html: `<!DOCTYPE html><html><head></head><body>${body}</body></html>`,
      styles: [],
      script: expect.stringMatching(BUNDLE_URL),
    });
    const first = await fetchPage(dev);
    expect(first).toEqual(page("<h1>Hello</h1>"));
    // The second request is served from the cached response.
    expect(await fetchPage(dev)).toEqual(first);

    await dev.patch("index.html", { find: "Hello", replace: "World" });
    expect(await fetchPage(dev)).toEqual(page("<h1>World</h1>"));

    await using c = await dev.client("/");
    await c.expectMessage("hello");
    expect(await c.elemText("h1")).toBe("World");

    // Editing HTML reloads the page.
    await c.expectReload(async () => {
      await dev.patch("index.html", { find: "World", replace: "Hello" });
      expect(await fetchPage(dev)).toEqual(page("<h1>Hello</h1>"));
    });
    await c.expectMessage("hello");
    expect(await c.elemText("h1")).toBe("Hello");

    await c.expectReload(async () => {
      await dev.patch("index.html", { find: "Hello", replace: "Bar" });
      expect(await fetchPage(dev)).toEqual(page("<h1>Bar</h1>"));
    });
    await c.expectMessage("hello");
    expect(await c.elemText("h1")).toBe("Bar");

    // Editing the script reloads the page too, because the module does not
    // accept updates. The HTML does not change.
    await c.expectReload(async () => {
      await dev.patch("script.ts", { find: "hello", replace: "world" });
    });
    await c.expectMessage("world");
    expect(await fetchPage(dev)).toEqual(page("<h1>Bar</h1>"));
  },
});

devTest("image tag and image import", {
  files: {
    "index.html": `
      <!DOCTYPE html><html><head></head><body>
      <img src="image.png" alt="test image">
      <script type="module" src="script.ts"></script>
      </body></html>
    `,
    "script.ts": `
      import icon from "./icon.png";
      console.log(icon);
    `,
    "image.png": "FIRST",
    "icon.png": "ICON 1",
  },
  async test(dev) {
    const page = (img: string) => ({
      html: `<!DOCTYPE html><html><head></head><body>${img}</body></html>`,
      styles: [],
      script: expect.stringMatching(BUNDLE_URL),
    });
    await using c = await dev.client("/");

    // Both the tag's src and the import resolve to hashed asset URLs. The page
    // resolves the src against its origin.
    const icon = await c.getStringMessage();
    expect(icon).toMatch(assetUrl("png"));
    const img = new URL(await c.js`document.querySelector("img").src`);
    expect(img.origin).toBe(dev.baseUrl);
    expect(img.pathname).toMatch(assetUrl("png"));
    expect(img.pathname).not.toBe(icon);
    expect(await fetchPage(dev)).toEqual(page(`<img src="${img.pathname}" alt="test image">`));
    expect(await fetchAsset(dev, img.pathname, "image/png")).toBe("FIRST");
    expect(await fetchAsset(dev, icon, "image/png")).toBe("ICON 1");

    // Editing HTML reloads the page. Neither image changed, so neither did its URL.
    await c.expectReload(async () => {
      await dev.patch("index.html", { find: 'alt="test image"', replace: 'alt="modified image"' });
    });
    await c.expectMessage(icon);
    expect(await c.js`document.querySelector("img").src`).toBe(img.href);
    expect(await fetchPage(dev)).toEqual(page(`<img src="${img.pathname}" alt="modified image">`));

    // Editing the image in the tag reloads the page, because the HTML must
    // point at the new content. The old URL is gone.
    await c.expectReload(async () => {
      await dev.patch("image.png", { find: "FIRST", replace: "SECOND" });
    });
    await c.expectMessage(icon);
    const img2 = new URL(await c.js`document.querySelector("img").src`);
    expect(img2.pathname).toMatch(assetUrl("png"));
    expect(img2.pathname).not.toBe(img.pathname);
    expect(await fetchPage(dev)).toEqual(page(`<img src="${img2.pathname}" alt="modified image">`));
    expect(await fetchAsset(dev, img2.pathname, "image/png")).toBe("SECOND");
    await dev.fetch(img.pathname).expect404();

    // Editing the imported image reloads the page, and the import sees the new URL.
    await c.expectReload(async () => {
      await dev.patch("icon.png", { find: "ICON 1", replace: "ICON 2" });
    });
    const icon2 = await c.getStringMessage();
    expect(icon2).toMatch(assetUrl("png"));
    expect(icon2).not.toBe(icon);
    expect(await fetchAsset(dev, icon2, "image/png")).toBe("ICON 2");
    await dev.fetch(icon).expect404();
    expect(await c.js`document.querySelector("img").src`).toBe(img2.href);
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
    // The unresolved import fails the build, so the route serves the error page.
    // Serving it once leaked the route's source map in memory (#17738), which
    // the dev server's allocation checks at exit catch.
    const failed = await dev.fetch("/");
    expect(failed.status).toBe(500);
    expect(failed.headers.get("content-type")).toBe("text/html;charset=utf-8");
    expect(await failed.text()).toContain("<title>Bun - Build Failed</title>");

    await using c = await dev.client("/", {
      errors: ['script.ts:1:18: error: Could not resolve: "./data"'],
    });
    // Creating the missing file fixes the build and reloads the page.
    await c.expectReload(async () => {
      await dev.write("data.ts", "export default 'data';");
    });
    await c.expectMessage("data");
    expect(await fetchPage(dev)).toEqual({
      html: "<!DOCTYPE html><html><head></head><body></body></html>",
      styles: [],
      script: expect.stringMatching(BUNDLE_URL),
    });
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
    // The relative stylesheet and script are bundled and move into the injected
    // tags. The external icon link stays as it is.
    const page = await fetchPage(dev);
    expect(page).toEqual({
      html: '<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>index | Powered by Bun</title><link rel="icon" type="image/x-icon" href="https://bun.sh/favicon.ico" /></head><body><div id="root"></div></body></html>',
      styles: [expect.stringMatching(assetUrl("css"))],
      script: expect.stringMatching(BUNDLE_URL),
    });
    expect(await fetchAsset(dev, page.styles[0], "text/css;charset=utf-8")).toBe(
      "/* index.css */\nbody {\n  background-color: red;\n}\n",
    );
    expect(await fetchAsset(dev, page.script, "text/javascript;charset=utf-8")).toContain('console.log("hello")');

    await using c = await dev.client("/");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");
    const ico: string = await c.js`document.querySelector("link[rel='icon']").href`;
    expect(ico).toBe("https://bun.sh/favicon.ico");
  },
});

devTest("chrome devtools json and error report endpoints", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Endpoints</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    // Chrome DevTools automatic workspace folders. The uuid is a hash of the
    // entry point and the project root, so every request gets the same one.
    const devtoolsUrl = "/.well-known/appspecific/com.chrome.devtools.json";
    const devtools = await dev.fetch(devtoolsUrl);
    expect(devtools.status).toBe(200);
    expect(devtools.headers.get("content-type")).toBe("application/json");
    const workspace = await devtools.json();
    expect(workspace).toEqual({
      workspace: {
        root: dev.rootDir,
        uuid: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      },
    });
    expect(await dev.fetch(devtoolsUrl).json()).toEqual(workspace);

    // One frame in a project file and one whose absolute path is far larger
    // than any platform path buffer (16 KiB). Neither is in a bundle, so
    // neither is remapped. The reply makes a path relative to the root only
    // when it starts with "/": the project file on posix, never on Windows.
    // The oversized path is longer than the posix path buffers, so it stays
    // as is there. Windows (98K buffer) can make it relative, which drops its
    // trailing slash. The run of segments before that is stable.
    const projectFile = dev.join("script.ts");
    const segments = Buffer.alloc(2 * 8192, "A/").toString();
    const oversizedPath = "/" + segments;
    const longPath = await postErrorReport(dev, "test message", [
      frame(1, 1, "first", projectFile),
      frame(1, 1, "second", oversizedPath),
    ]);
    expect(longPath.status).toBe(200);
    expect(longPath.contentType).toBe("application/octet-stream");
    expect(decodeReport(longPath.reply)).toEqual({
      frames: [
        { line: 1, column: 1, functionName: "first", fileName: isWindows ? projectFile : "script.ts" },
        { line: 1, column: 1, functionName: "second", fileName: expect.stringContaining(segments.slice(0, -1)) },
      ],
      contextLines: 0,
    });
    // The report is printed to the dev server's terminal.
    await dev.output.waitForLine(/error.*test message/);

    // The Origin header has to be the dev server's own when it is present.
    const crossOrigin = await postErrorReport(dev, "origin-check-message", [], { Origin: "http://other-page.example" });
    expect(crossOrigin.reply.toString()).toBe("Blocked: Origin header does not match the dev server");
    expect(crossOrigin.status).toBe(403);
    const sameOrigin = await postErrorReport(dev, "origin-check-message", [], { Origin: dev.baseUrl });
    expect(sameOrigin.status).toBe(200);
    expect(decodeReport(sameOrigin.reply)).toEqual({ frames: [], contextLines: 0 });

    // A stray C1 control byte in a frame is blanked, in the terminal and in the reply.
    const functionName = Buffer.concat([Buffer.from("fnstart"), Buffer.from([0x9b]), Buffer.from("fnend")]);
    const strayByte = await postErrorReport(dev, "frame-bytes-message", [frame(1, 1, functionName, "foo.ts")]);
    expect(strayByte.status).toBe(200);
    expect(decodeReport(strayByte.reply)).toEqual({
      frames: [{ line: 1, column: 1, functionName: "fnstart fnend", fileName: "foo.ts" }],
      contextLines: 0,
    });
    await dev.output.waitForLine(/at .*fnstart fnend.*foo\.ts/);

    // The dev server still serves the page afterwards.
    expect(await fetchPage(dev)).toEqual({
      html: "<!DOCTYPE html><html><head></head><body><h1>Endpoints</h1></body></html>",
      styles: [],
      script: expect.stringMatching(BUNDLE_URL),
    });
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
