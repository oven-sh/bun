// HTML tests are tests relating to HTML files themselves.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile } from "../bake-harness";

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

// A stylesheet link must not put a script in the page. The page fails when Bun loads the link target as a script.
const stylesheetLinkError = (file: string) => `index.html: error: Cannot use "${file}" as a stylesheet`;

devTest("a stylesheet link to a script fails the page until the link is fixed", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["./theme.js"], body: "<h1>Page</h1>" }),
    "theme.js": `console.log("theme-script");`,
    "theme.css": `h1 { color: red; }`,
  },
  async test(dev) {
    await using c = await dev.client("/", { errors: [stylesheetLinkError("theme.js")] });
    // The first bundle put the script in the module cache. The page still fails.
    expect([(await dev.fetch("/")).status, (await dev.fetch("/")).status]).toEqual([500, 500]);

    await c.expectReload(async () => {
      await dev.write("index.html", emptyHtmlFile({ styles: ["./theme.css"], body: "<h1>Page</h1>" }));
    });
    await c.style("h1").color.expect.toBe("red");
  },
});
devTest("a page fails when it gains a stylesheet link to a script that it already loads", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["./app.js"] }),
    "app.js": `console.log("app");`,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);

    // Only the page is bundled again. The script comes from the module cache.
    await dev.write("index.html", emptyHtmlFile({ styles: ["./app.js"], scripts: ["./app.js"] }), { errors: null });
    await using c = await dev.client("/", { errors: [stylesheetLinkError("app.js")] });

    await c.expectReload(async () => {
      await dev.write("index.html", emptyHtmlFile({ scripts: ["./app.js"] }));
    });
    await c.expectMessage("app");
  },
});
devTest("a stylesheet link to a script with a syntax error still fails the page after the script is repaired", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["./theme.js"], body: "<h1>Page</h1>" }),
    "theme.js": `const = ;`,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    // Only the script is repaired. The link to it is still an error.
    await dev.write("theme.js", `console.log("theme-script");`, { errors: null });
    await using c = await dev.client("/", { errors: [stylesheetLinkError("theme.js")] });
  },
});
// A page that failed on a link to a cached script is bundled again when that script goes away.
devTest("a page with a stylesheet link to a script that it loaded before follows that script", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["./app.js"] }),
    "app.js": `console.log("app");`,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);

    await dev.write("index.html", emptyHtmlFile({ styles: ["./app.js"] }), { errors: null });
    await using c = await dev.client("/", { errors: [stylesheetLinkError("app.js")] });
    await dev.delete("app.js", { errors: ['index.html: error: Could not resolve: "./app.js"'] });
  },
});
// A plugin can make a script of a stylesheet, to add the styles at run time. Those pages build, and the plugin loads the file once.
devTest("pages keep a stylesheet link to a file that a plugin loads as a script", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-to-js-plugin.ts"]
    `,
    "css-to-js-plugin.ts": `
      let loads = 0;
      export default {
        name: "css-to-js",
        setup(build) {
          build.onLoad({ filter: /\\.css$/ }, () => {
            loads++;
            return { contents: "console.log('styles-load-" + loads + "');", loader: "js" };
          });
        },
      };
    `,
    "first.html": emptyHtmlFile({ styles: ["./styles.css"], body: "<h1>one</h1>" }),
    "second.html": emptyHtmlFile({ styles: ["./styles.css"], body: "<h1>second</h1>" }),
    "styles.css": `h1 { color: red; }`,
  },
  async test(dev) {
    await using second = await dev.client("/second");
    await second.expectMessage("styles-load-1");
    await using first = await dev.client("/first");
    await first.expectMessage("styles-load-1");

    // Only the first page is bundled again. The plugin does not load the stylesheet again.
    await first.expectReload(async () => {
      await dev.patch("first.html", { find: "one", replace: "two" });
    });
    await first.expectMessage("styles-load-1");
    // The second page got no new module: it did not reload and its script did not run again.
    await second.expectMessage();
  },
});
// A plugin can also make a stylesheet of a file with a script path. The plugin loads that file once, too.
devTest("pages keep a stylesheet link to a script path that a plugin loads as CSS", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./to-css-plugin.ts"]
    `,
    "to-css-plugin.ts": `
      const colors = ["red", "green", "blue"];
      let loads = 0;
      export default {
        name: "to-css",
        setup(build) {
          build.onLoad({ filter: /generated\\.js$/ }, () => ({
            contents: "h1 { color: " + colors[loads++] + "; }",
            loader: "css",
          }));
        },
      };
    `,
    "first.html": emptyHtmlFile({ styles: ["./generated.js"], body: "<h1>one</h1>" }),
    "second.html": emptyHtmlFile({ styles: ["./generated.js"], body: "<h1>second</h1>" }),
    "generated.js": `not a script`,
  },
  async test(dev) {
    await using first = await dev.client("/first");
    await first.style("h1").color.expect.toBe("red");
    await using second = await dev.client("/second");
    await second.style("h1").color.expect.toBe("red");

    await first.expectReload(async () => {
      await dev.patch("first.html", { find: "one", replace: "two" });
    });
    await first.style("h1").color.expect.toBe("red");
  },
});
// While such a plugin throws, the file has the loader of its path. The page gets no error of its own for that.
devTest("a plugin throws for a stylesheet that has a script path", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-in-ts-plugin.ts"]
    `,
    "css-in-ts-plugin.ts": `
      export default {
        name: "css-in-ts",
        setup(build) {
          build.onLoad({ filter: /\\.css\\.ts$/ }, () => {
            throw new Error("styles.css.ts is broken");
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ styles: ["./styles.css.ts"], body: "<h1>Page</h1>" }),
    "styles.css.ts": `export const color = "red";`,
  },
  async test(dev) {
    await using c = await dev.client("/", { errors: ["styles.css.ts: error: styles.css.ts is broken"] });
  },
});
