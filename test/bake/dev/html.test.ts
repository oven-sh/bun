// HTML tests are tests relating to HTML files themselves.
import { expect } from "bun:test";
import { type Dev, devTest, emptyHtmlFile } from "../bake-harness";

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

// A page load is three steps: fetch the HTML, fetch the client bundle the HTML
// names, then open `/_bun/hmr` and subscribe to hot updates. A rebuild that
// lands between the last two steps publishes its hot update to nobody. The
// page only finds out through the `i` (init) frame of its handshake, which
// carries the generation of the bundle it loaded.
const clientScriptSrc = (html: string) => html.match(/src="(\/_bun\/client\/[^"]+\.js)"/)![1];
// The script URL ends in `{route bundle index}{generation}.js`, 8 hex digits each.
const generationOfScript = (src: string) => src.slice(-11, -3);

/**
 * Opens an HMR socket and replays the handshake of `hmr-runtime-client.ts` for
 * a page that loaded the bundle with `generation`. Returns the kind of every
 * frame received up to the `n` (set_url) reply. The server handles the frames
 * of one socket in order, so by then it has handled `i` too.
 */
async function hmrHandshake(dev: Dev, generation: string): Promise<string[]> {
  const frames: string[] = [];
  const done = Promise.withResolvers<string[]>();
  const ws = new WebSocket(dev.baseUrl.replace(/^http/, "ws") + "/_bun/hmr");
  ws.binaryType = "arraybuffer";
  ws.onmessage = ({ data }) => {
    const kind = String.fromCharCode(new Uint8Array(data as ArrayBuffer)[0]);
    frames.push(kind);
    if (kind === "V") {
      ws.send("she"); // subscribe to hot_update and errors
      ws.send("i" + generation); // init
      ws.send("n/"); // set_url
    } else if (kind === "n") {
      done.resolve(frames);
    }
  };
  ws.onclose = () => done.reject(new Error(`hmr socket closed after [${frames}]`));
  try {
    return await done.promise;
  } finally {
    ws.onclose = null;
    ws.close();
  }
}

devTest("hmr socket tells a page that loaded an outdated bundle to reload", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./value";
      console.log("value: " + value);
    `,
    "value.ts": `
      export const value = 1;
    `,
  },
  async test(dev) {
    const staleSrc = clientScriptSrc(await dev.fetch("/").text());
    const staleGeneration = generationOfScript(staleSrc);
    expect(await dev.fetch(staleSrc).text()).toInclude(`generation: "${staleGeneration}"`);

    // Rebuild the route while no page is subscribed to hot updates.
    await dev.write("value.ts", `export const value = 2;`);
    const currentSrc = clientScriptSrc(await dev.fetch("/").text());
    expect(currentSrc).not.toBe(staleSrc);

    expect(await hmrHandshake(dev, staleGeneration)).toEqual(["V", "R", "n"]);
    expect(await hmrHandshake(dev, generationOfScript(currentSrc))).toEqual(["V", "n"]);
  },
});
devTest("a page whose bundle went stale while it loaded reloads once its hmr socket connects", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./value";
      console.log("value: " + value);
    `,
    "value.ts": `
      export const value = 1;
    `,
  },
  async test(dev) {
    // The page talks to the dev server through this proxy. The proxy parks the
    // page's `/_bun/hmr` upgrade until `releaseSocket` resolves and passes
    // everything else straight through.
    const releaseSocket = Promise.withResolvers<void>();
    const bundleServed = Promise.withResolvers<void>();
    type Relay = { upstream: WebSocket | null; queued: (string | Buffer)[] };
    await using proxy = Bun.serve<Relay>({
      port: 0,
      async fetch(req, server) {
        const { pathname } = new URL(req.url);
        if (pathname === "/_bun/hmr") {
          await releaseSocket.promise;
          if (server.upgrade(req, { data: { upstream: null, queued: [] } })) return;
          return new Response(null, { status: 400 });
        }
        const res = await fetch(new URL(pathname, dev.baseUrl), { method: req.method, headers: req.headers });
        const body = await res.arrayBuffer();
        const headers = new Headers(res.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        if (pathname.startsWith("/_bun/client/")) bundleServed.resolve();
        return new Response(body, { status: res.status, headers });
      },
      websocket: {
        open(ws) {
          const upstream = new WebSocket(dev.baseUrl.replace(/^http/, "ws") + "/_bun/hmr");
          upstream.binaryType = "arraybuffer";
          upstream.onopen = () => {
            for (const message of ws.data.queued.splice(0)) upstream.send(message);
          };
          upstream.onmessage = ({ data }) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(data as ArrayBuffer);
          };
          upstream.onclose = () => ws.close();
          ws.data.upstream = upstream;
        },
        message(ws, message) {
          const { upstream, queued } = ws.data;
          if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
          else queued.push(message);
        },
        close(ws) {
          const { upstream } = ws.data;
          if (upstream) {
            upstream.onclose = null;
            upstream.close();
          }
        },
      },
    });

    // The page loads `value: 1`. Its HMR socket is parked in the proxy.
    const pageLoaded = dev.client(`http://localhost:${proxy.port}/`, { allowUnlimitedReloads: true });
    await Promise.race([bundleServed.promise, pageLoaded]);
    // The route is rebuilt. Its hot update reaches no page.
    await dev.write("value.ts", `export const value = 2;`);
    // Now the page's socket gets through, and the handshake tells it to reload.
    releaseSocket.resolve();
    await using c = await pageLoaded;
    await c.expectMessage("value: 1", "value: 2");
  },
});
