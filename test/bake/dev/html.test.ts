// HTML tests are tests relating to HTML files themselves.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import net from "node:net";
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

/**
 * Status line of a raw `/_bun/hmr` WebSocket handshake sent with the given
 * `Host`. `Origin` defaults to the same host, the way a browser sends it for a
 * page served by this dev server.
 */
function hmrHandshakeStatus(dev: Dev, host: string, origin = `http://${host}`): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = net.connect(dev.port, "127.0.0.1", () => {
    socket.write(
      `GET /_bun/hmr HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `Origin: ${origin}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
    );
  });
  let received = "";
  socket.on("data", chunk => {
    received += chunk;
    if (received.includes("\r\n\r\n")) {
      resolve(received.split("\r\n")[0]);
      socket.destroy();
    }
  });
  socket.on("error", reject);
  socket.on("close", () => reject(new Error(`socket closed before the response ended: ${JSON.stringify(received)}`)));
  return promise;
}

devTest("development.allowedHosts lets the dev server answer for extra hostnames", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["/style.css"],
      scripts: ["/script.ts"],
      body: "<h1>Allowed Hosts</h1>",
    }),
    "style.css": `
      h1 { color: red; }
    `,
    "script.ts": `
      console.log("hello");
    `,
    // The harness-generated bun.app.ts has no `development` object, so
    // provide one directly. `htmlFiles: []` tells the harness not to
    // generate its own config from index.html.
    "bun.app.ts": `
      import html from "./index.html";
      export default {
        static: {
          "/": html,
        },
        development: {
          allowedHosts: ["mybox.local", ".tunnel.example"],
        },
        fetch(req) {
          return new Response("Not Found", { status: 404 });
        },
      };
    `,
  },
  htmlFiles: [],
  async test(dev) {
    // Hostnames match case-insensitively and without the port.
    const page = await dev.fetch("/", { headers: { Host: "MYBOX.local:3000" } });
    const pageText = await page.text();
    expect(pageText).toContain("<h1>Allowed Hosts</h1>");
    expect(page.status).toBe(200);

    // The script and stylesheet the page references load under that host too,
    // as does the HMR WebSocket.
    const [, scriptUrl] = pageText.match(/src="(\/_bun\/client\/[^"]+)"/)!;
    const [, styleUrl] = pageText.match(/href="(\/_bun\/asset\/[^"]+)"/)!;
    const script = await dev.fetch(scriptUrl, { headers: { Host: "mybox.local" } });
    expect(await script.text()).toContain('console.log("hello")');
    expect(script.status).toBe(200);
    const style = await dev.fetch(styleUrl, { headers: { Host: "mybox.local" } });
    expect(await style.text()).toContain("color: red");
    expect(style.status).toBe(200);
    expect(await hmrHandshakeStatus(dev, "mybox.local")).toBe("HTTP/1.1 101 Switching Protocols");

    // A leading "." allows the domain itself and every subdomain.
    for (const host of ["tunnel.example", "a.b.tunnel.example"]) {
      const res = await dev.fetch("/", { headers: { Host: host } });
      expect(await res.text()).toContain("<h1>Allowed Hosts</h1>");
      expect(res.status).toBe(200);
      expect(await hmrHandshakeStatus(dev, host)).toBe("HTTP/1.1 101 Switching Protocols");
    }

    // The Origin check is separate: a page on another origin cannot open the
    // HMR socket through an allowed host, not even one that the list allows.
    expect(await hmrHandshakeStatus(dev, "mybox.local", "http://other-page.example")).toBe("HTTP/1.1 403 Forbidden");
    expect(await hmrHandshakeStatus(dev, "mybox.local", "http://evil.tunnel.example")).toBe("HTTP/1.1 403 Forbidden");

    // Every other hostname is still blocked, and the response says how to allow it.
    for (const host of ["nottunnel.example", "mybox.local.example", "rebound-host.example"]) {
      const res = await dev.fetch("/", { headers: { Host: host } });
      const text = await res.text();
      expect(text).not.toContain("/_bun/client/");
      expect(text).toContain("development.allowedHosts");
      expect(res.status).toBe(403);
      const blockedScript = await dev.fetch(scriptUrl, { headers: { Host: host } });
      expect(blockedScript.status).toBe(403);
    }
    expect(await hmrHandshakeStatus(dev, "rebound-host.example")).toBe("HTTP/1.1 403 Forbidden");

    // The built-in list still applies.
    const local = await dev.fetch("/", { headers: { Host: "app.localhost" } });
    expect(await local.text()).toContain("<h1>Allowed Hosts</h1>");
    expect(local.status).toBe(200);
  },
});

devTest("development.allowedHosts: true turns the host check off", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Any Host</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
    "bun.app.ts": `
      import html from "./index.html";
      export default {
        static: {
          "/": html,
        },
        development: {
          allowedHosts: true,
        },
        fetch(req) {
          return new Response("Not Found", { status: 404 });
        },
      };
    `,
  },
  htmlFiles: [],
  async test(dev) {
    const page = await dev.fetch("/", { headers: { Host: "any-host.example" } });
    const pageText = await page.text();
    expect(pageText).toContain("<h1>Any Host</h1>");
    expect(page.status).toBe(200);

    const [, scriptUrl] = pageText.match(/src="(\/_bun\/client\/[^"]+)"/)!;
    const script = await dev.fetch(scriptUrl, { headers: { Host: "any-host.example" } });
    expect(script.status).toBe(200);
    expect(await hmrHandshakeStatus(dev, "any-host.example")).toBe("HTTP/1.1 101 Switching Protocols");

    // `true` only turns the Host check off. The Origin check still applies.
    expect(await hmrHandshakeStatus(dev, "any-host.example", "http://other-page.example")).toBe(
      "HTTP/1.1 403 Forbidden",
    );
  },
});

devTest("[serve.static] allowedHosts in bunfig.toml configures the dev server host check", {
  files: {
    "bunfig.toml": `
      [serve.static]
      allowedHosts = ["mybox.local", ".tunnel.example"]
    `,
    "index.html": emptyHtmlFile({
      scripts: ["/script.ts"],
      body: "<h1>Bunfig Hosts</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    // The harness-generated bun.app.ts has no `development` object, so the
    // bunfig value is what the server uses.
    for (const host of ["mybox.local", "a.tunnel.example"]) {
      const page = await dev.fetch("/", { headers: { Host: host } });
      const pageText = await page.text();
      expect(pageText).toContain("<h1>Bunfig Hosts</h1>");
      expect(page.status).toBe(200);
      const [, scriptUrl] = pageText.match(/src="(\/_bun\/client\/[^"]+)"/)!;
      const script = await dev.fetch(scriptUrl, { headers: { Host: host } });
      expect(script.status).toBe(200);
      expect(await hmrHandshakeStatus(dev, host)).toBe("HTTP/1.1 101 Switching Protocols");
    }

    const blocked = await dev.fetch("/", { headers: { Host: "rebound-host.example" } });
    expect(await blocked.text()).toContain("bunfig.toml");
    expect(blocked.status).toBe(403);
  },
});

test("[serve.static] allowedHosts rejects values that are not hostnames", async () => {
  using dir = tempDir("allowed-hosts-bunfig", {
    "bunfig.toml": `
      [serve.static]
      allowedHosts = ["http://mybox.local"]
    `,
    "index.ts": `
      console.log("unreachable");
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain(
    'Expected allowedHosts entry to be a hostname without a scheme, port, or path (a leading "." allows subdomains)',
  );
  expect(exitCode).toBe(1);
});

test("development.allowedHosts rejects values that are not hostnames", () => {
  const serve = (allowedHosts: unknown) => {
    const server = Bun.serve({
      port: 0,
      development: { allowedHosts } as any,
      fetch() {
        return new Response("unreachable");
      },
    });
    // Only reached when the option was accepted, which fails the assertion below.
    server.stop(true);
  };
  expect(() => serve("mybox.local")).toThrow(
    "Bun.serve() expects 'development.allowedHosts' to be an array of hostnames or true",
  );
  expect(() => serve([42])).toThrow(
    "Bun.serve() expects 'development.allowedHosts' to be an array of hostnames or true",
  );
  for (const entry of ["", ".", "http://mybox.local", "mybox.local:3000", "mybox.local/app", "*.tunnel.example"]) {
    expect(() => serve([entry])).toThrow(
      `Bun.serve() expects each entry of 'development.allowedHosts' to be a hostname without a scheme, port, or path (a leading "." allows subdomains), got "${entry}"`,
    );
  }
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
