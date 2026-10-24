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

// A file that failed to build has no bundled copy, and a bundle takes every file that did not change
// from the cache. A route that reaches the failed file through such a file must answer the build
// error, not a page that cannot load the module.
const pkgThatImportsBad = `
  import { bad } from "./bad";
  export { bad };
`;
const importsPkg = (name: string) => `
  import { bad } from "./pkg";
  console.log("${name}: " + bad);
`;
const syntaxError = { source: `export const bad = ;`, failures: { "bad.ts": ["Unexpected ;"] } };
const unresolvedImport = {
  source: `
    import "not-installed-peer";
    export const bad = 1;
  `,
  failures: { "bad.ts": [`Could not resolve: "not-installed-peer". Maybe you need to "bun install"?`] },
};
// A request for a route that reaches a failure answers from the record of the failure, or builds the
// route again when the flag is "0", the default of release builds.
for (const assumePerfectIncremental of ["0", "1"]) {
  const env = { BUN_ASSUME_PERFECT_INCREMENTAL: assumePerfectIncremental };
  const flag = `BUN_ASSUME_PERFECT_INCREMENTAL=${assumePerfectIncremental}`;
  for (const [kind, bad] of [
    ["a syntax error", syntaxError],
    ["an unresolved import", unresolvedImport],
  ] as const) {
    devTest(`a file with ${kind} fails the build again when a route imports it again (${flag})`, {
      env,
      files: {
        "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
        "index.ts": importsPkg("index"),
        "pkg.ts": pkgThatImportsBad,
        "bad.ts": bad.source,
      },
      async test(dev) {
        await dev.fetch("/").expectBuildError(bad.failures);
        await dev.write("index.ts", `console.log("no import");`);
        expect((await dev.fetch("/")).status).toBe(200);
        // This bundle takes pkg.ts from the cache, so it does not parse bad.ts.
        await dev.write("index.ts", importsPkg("index"));
        await dev.fetch("/").expectBuildError(bad.failures);
        await dev.fetch("/").expectBuildError(bad.failures);
        await dev.write("bad.ts", `export const bad = "fixed";`);
        expect((await dev.fetch("/")).status).toBe(200);
      },
    });
  }
  devTest(`the first bundle of a route takes the importer of a failed file from the cache (${flag})`, {
    env,
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "other.html": emptyHtmlFile({ scripts: ["other.ts"] }),
      "unrelated.html": emptyHtmlFile({ scripts: ["unrelated.ts"] }),
      "index.ts": importsPkg("index"),
      "other.ts": importsPkg("other"),
      "unrelated.ts": `console.log("unrelated");`,
      "pkg.ts": pkgThatImportsBad,
      "bad.ts": syntaxError.source,
    },
    async test(dev) {
      await dev.fetch("/index").expectBuildError(syntaxError.failures);
      await dev.fetch("/other").expectBuildError(syntaxError.failures);
      await dev.fetch("/other").expectBuildError(syntaxError.failures);
      // A route that does not reach the failed file still loads, also after the end of another bundle.
      expect((await dev.fetch("/unrelated")).status).toBe(200);
      await dev.write("other.ts", importsPkg("other again"));
      expect((await dev.fetch("/unrelated")).status).toBe(200);
      {
        await using c = await dev.client("/unrelated");
        await c.expectMessage("unrelated");
      }
      await dev.write("bad.ts", `export const bad = "fixed";`);
      expect((await dev.fetch("/other")).status).toBe(200);
    },
  });
  // A tab asks for the page and then for its script. A bundle can end between the two requests.
  devTest(`the script of a route that reaches no failure is served while another route has a failure (${flag})`, {
    env,
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "other.html": emptyHtmlFile({ scripts: ["other.ts"] }),
      "unrelated.html": emptyHtmlFile({ scripts: ["unrelated.ts"] }),
      "index.ts": importsPkg("index"),
      "other.ts": `console.log("other");`,
      "unrelated.ts": `console.log("unrelated");`,
      "pkg.ts": pkgThatImportsBad,
      "bad.ts": syntaxError.source,
    },
    async test(dev) {
      await dev.fetch("/index").expectBuildError(syntaxError.failures);
      const page = await dev.fetch("/unrelated").text();
      const script = page.match(/src="(\/_bun\/client\/[^"]+)"/)![1];
      const scriptHasTheModule = async () => (await dev.fetch(script).text()).includes(`console.log("unrelated")`);
      expect(await scriptHasTheModule()).toBe(true);
      // The first bundle of another route.
      expect((await dev.fetch("/other")).status).toBe(200);
      expect(await scriptHasTheModule()).toBe(true);
      // With the flag at "0", a request for the failed route is a bundle.
      await dev.fetch("/index").expectBuildError(syntaxError.failures);
      expect(await scriptHasTheModule()).toBe(true);
    },
  });
  devTest(`a file that fails while no route imports it fails the route that imports it later (${flag})`, {
    env,
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "index.ts": importsPkg("index"),
      "pkg.ts": pkgThatImportsBad,
      "bad.ts": `export const bad = "good";`,
    },
    async test(dev) {
      expect((await dev.fetch("/")).status).toBe(200);
      await dev.write("index.ts", `console.log("no import");`);
      await dev.write("bad.ts", syntaxError.source);
      // The failure is on record, and no route reaches it.
      {
        await using c = await dev.client("/");
        await c.expectMessage("no import");
      }
      await dev.write("index.ts", importsPkg("index"));
      await dev.fetch("/").expectBuildError(syntaxError.failures);
    },
  });
  devTest(`an open tab gets the build error of a failed file that its route starts to import (${flag})`, {
    env,
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "other.html": emptyHtmlFile({ scripts: ["other.ts"] }),
      "index.ts": `console.log("no import");`,
      "other.ts": importsPkg("other"),
      "pkg.ts": pkgThatImportsBad,
      "bad.ts": syntaxError.source,
    },
    async test(dev) {
      await dev.fetch("/other").expectBuildError(syntaxError.failures);
      await using c = await dev.client("/index");
      await c.expectMessage("no import");
      await c.expectReload(async () => {
        await dev.write("index.ts", importsPkg("index"), { errors: ["bad.ts:1:20: error: Unexpected ;"] });
      });
      await c.expectReload(async () => {
        await dev.write("bad.ts", `export const bad = "fixed";`);
      });
      await c.expectMessage("index: fixed");
    },
  });
  devTest(`the build failure page reloads when its route no longer imports the failed file (${flag})`, {
    env,
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "index.ts": importsPkg("index"),
      "pkg.ts": pkgThatImportsBad,
      "bad.ts": syntaxError.source,
    },
    async test(dev) {
      await using c = await dev.client("/", { errors: ["bad.ts:1:20: error: Unexpected ;"] });
      // bad.ts is not built again, so its failure stays on record.
      await c.expectReload(async () => {
        await dev.write("index.ts", `console.log("no import");`, { errors: null });
      });
      await c.expectMessage("no import");
    },
  });
}
