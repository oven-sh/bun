// HTML tests are tests relating to HTML files themselves.
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

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

const nodeModulesPathCases = [
  ["relativeLibrary", "node_modules/pkg/index.js", true],
  ["posixLibrary", "/x/node_modules/pkg/index.js", true],
  ["windowsLibrary", "C:\\x\\node_modules\\pkg\\index.js", true],
  ["windowsDoubleSlashLibrary", "C://node_modules/pkg/index.js", true],
  ["mixedAfterLibrary", "C:\\x\\node_modules/pkg/index.js", true],
  ["mixedBeforeLibrary", "C:/x/node_modules\\pkg\\index.js", true],
  ["urlLibrary", "https://example.test/x/node_modules/pkg/index.js?from=app", true],
  ["posixQuestionFilename", "/x/name?part/node_modules/pkg/index.js", true],
  ["posixHashFilename", "/x/name#part/node_modules/pkg/index.js", true],
  ["urlAuthority", "https://node_modules/pkg/index.js", false],
  ["urlAuthorityThenPath", "https://node_modules/node_modules/pkg/index.js", true],
  ["componentPrefix", "/x/my_node_modules_backup/index.js", false],
  ["componentSuffix", "/x/node_modules_backup/index.js", false],
  ["posixBackslashFilename", "file:///x/foo\\node_modules\\bar.js", false],
  ["urlQuery", "https://example.test/app.js?q=/node_modules/pkg", false],
  ["urlFragment", "https://example.test/app.js#/node_modules/pkg", false],
  ["bareComponent", "node_modules", false],
] as const;

devTest("runtime errors identify node_modules path components", {
  framework: minimalFramework,
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        // happy-dom stringifies ArrayBuffer bodies; browsers preserve the bytes.
        if (String(input).includes("/_bun/report_error")) {
          init = { ...init, body: new Uint8Array(init.body) };
        }
        return originalFetch(input, init);
      };
      const pathCases = ${JSON.stringify(nodeModulesPathCases)};
      const error = new Error("stack path fixture");
      error.stack = "Error: stack path fixture\\n" + pathCases.map(([fn, file], index) =>
        "    at " + fn + " (" + file + ":" + (index + 1) + ":1)"
      ).join("\\n");
      queueMicrotask(() => { throw error; });
    `,
  },
  async test(dev) {
    await using client = await dev.client("/", { errors: ["error: stack path fixture"] });

    const overlayFrames = await client.js<
      { text: string; isLibrary: boolean; opacity: number | null }[]
    >`Array.from(document.querySelector("bun-hmr").shadowRoot.querySelectorAll(".r-error .trace-frame")).map(frame => {
      const opacity = getComputedStyle(frame).opacity;
      return {
        text: frame.textContent,
        isLibrary: frame.classList.contains("library-frame"),
        opacity: opacity === "" ? null : Number(opacity),
      };
    })`;
    const stripAnsi = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

    for (const [fn, , isLibrary] of nodeModulesPathCases) {
      const overlayFrame = overlayFrames.find(frame => frame.text.includes(fn));
      expect(overlayFrame, fn).toMatchObject({
        isLibrary,
        opacity: isLibrary ? 0.5 : null,
      });

      const terminalLine = dev.output.lines.find(line => stripAnsi(line).includes(`at ${fn} (`));
      expect(terminalLine, fn).toBeDefined();
      expect(terminalLine!.includes(`\x1b[2mat ${fn}`), fn).toBe(isLibrary);
    }
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
