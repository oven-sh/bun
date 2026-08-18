// CSS bundling bugs in DevServer; independent cases share one dev server, one route each, and clean up after themselves.
import { expect } from "bun:test";
import assert from "node:assert";
import type { Dev } from "../bake-harness";
import { devTest, emptyHtmlFile, imageFixtures, minimalFramework } from "../bake-harness";

/** The stylesheet URLs the dev server injected into an HTML route (source `<link>` tags are ignored). */
async function stylesheetUrls(dev: Dev, route: string): Promise<string[]> {
  const res = await dev.fetch(route);
  expect(res.status).toBe(200);
  const html = await res.text();
  return [...html.matchAll(/<link rel="stylesheet" href="(\/_bun\/asset\/[0-9a-f]{16}\.css)">/g)].map(m => m[1]);
}

async function fetchCss(dev: Dev, url: string): Promise<string> {
  const res = await dev.fetch(url);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/css;charset=utf-8");
  return res.text();
}

/** Resolves served CSS chunk URLs to the file name in the comment each chunk starts with. */
function stylesheetFileNames(dev: Dev, hrefs: string[]): Promise<string[]> {
  return Promise.all(
    hrefs.map(async href => {
      const css = await fetchCss(dev, href);
      const header = css.match(/^\/\* (.*) \*\/\n/);
      if (!header) throw new Error(`${href} does not start with a file name comment:\n${css}`);
      return header[1];
    }),
  );
}

/** The `color` each stylesheet linked from `route` (one chunk per CSS root) declares for `selector`. */
async function linkedStylesheetColors(dev: Dev, route: string, selector: string): Promise<string[]> {
  const hrefs = await stylesheetUrls(dev, route);
  return Promise.all(
    hrefs.map(async href => {
      const css = await fetchCss(dev, href);
      const rule = css.match(new RegExp(`^${selector.replaceAll(".", "\\.")}\\s*\\{\\s*color:\\s*([^;]+);`, "m"));
      if (!rule) {
        throw new Error(`No ${selector} rule in ${href}:\n${css}`);
      }
      return rule[1];
    }),
  );
}

/** The exact stylesheet served for a route that links exactly one stylesheet. */
async function servedCss(dev: Dev, route: string): Promise<string> {
  const urls = await stylesheetUrls(dev, route);
  expect(urls).toHaveLength(1);
  return fetchCss(dev, urls[0]);
}

/** Expects the error page; only call it for a route no connected client has loaded (#31908), unless the HTML file itself fails. */
async function expectBuildFailed(dev: Dev, route: string) {
  const res = await dev.fetch(route);
  expect(res.status).toBe(500);
  expect(await res.text()).toContain("<title>Bun - Build Failed</title>");
}

devTest("hot updates through @import graphs", {
  files: {
    // css import another css file
    "import.html": emptyHtmlFile({ styles: ["import.css"] }),
    "import.css": `
      @import "./imported.css";
      body {
        color: red;
      }
    `,
    "imported.css": `
      h1 {
        color: blue;
      }
    `,
    // circular css imports handle hot reload
    "circular.html": emptyHtmlFile({
      styles: ["circular-a.css"],
      body: `
        <div class="a">hello</div>
        <div class="b">hello</div>
      `,
    }),
    "circular-a.css": `
      @import "./circular-b.css";
      .a { color: red; }
    `,
    "circular-b.css": `
      @import "./circular-a.css";
      .b { color: blue; }
    `,
    // removing and re-adding css import
    "toggle.html": emptyHtmlFile({ styles: ["toggle.css"] }),
    "toggle.css": `
      @import "./toggle-colors.css";
      .main { background: white; }
    `,
    "toggle-colors.css": `
      .colored { color: blue; }
    `,
  },
  async test(dev) {
    // css import another css file
    {
      await using c = await dev.client("/import");
      await c.style("h1").color.expect.toBe("#00f");
      await c.style("body").color.expect.toBe("red");
      expect(await servedCss(dev, "/import")).toMatchInlineSnapshot(`
        "/* imported.css */
        h1 {
          color: #00f;
        }

        /* import.css */
        body {
          color: red;
        }
        "
      `);

      await dev.write(
        "imported.css",
        `
          h1 {
            color: green;
          }
        `,
        { errors: null },
      );
      await c.style("h1").color.expect.toBe("green");
      await c.style("body").color.expect.toBe("red");
      // A fresh load of the page gets the updated chunk too.
      expect(await servedCss(dev, "/import")).toMatchInlineSnapshot(`
        "/* imported.css */
        h1 {
          color: green;
        }

        /* import.css */
        body {
          color: red;
        }
        "
      `);
    }

    // circular css imports handle hot reload
    {
      await using c = await dev.client("/circular");
      await c.style(".a").color.expect.toBe("red");
      await c.style(".b").color.expect.toBe("#00f");
      expect(await servedCss(dev, "/circular")).toMatchInlineSnapshot(`
        "/* circular-b.css */
        .b {
          color: #00f;
        }

        /* circular-a.css */
        .a {
          color: red;
        }
        "
      `);

      await dev.write(
        "circular-a.css",
        `
          @import "./circular-b.css";
          .a { color: green; }
        `,
        { errors: null },
      );
      await c.style(".a").color.expect.toBe("green");
      await c.style(".b").color.expect.toBe("#00f");
      expect(await servedCss(dev, "/circular")).toMatchInlineSnapshot(`
        "/* circular-b.css */
        .b {
          color: #00f;
        }

        /* circular-a.css */
        .a {
          color: green;
        }
        "
      `);
    }

    // removing and re-adding css import
    {
      await using c = await dev.client("/toggle");
      await c.style(".colored").color.expect.toBe("#00f");
      const withImport = await servedCss(dev, "/toggle");
      expect(withImport).toMatchInlineSnapshot(`
        "/* toggle-colors.css */
        .colored {
          color: #00f;
        }

        /* toggle.css */
        .main {
          background: #fff;
        }
        "
      `);

      await dev.write(
        "toggle.css",
        `
          /* @import "./toggle-colors.css"; */
          .main { background: white; }
        `,
        { errors: null },
      );
      await c.style(".colored").notFound();
      await c.style(".main").backgroundColor.expect.toBe("#fff");
      const withoutImport = await servedCss(dev, "/toggle");
      expect(withoutImport).toMatchInlineSnapshot(`
        "/* toggle.css */
        .main {
          background: #fff;
        }
        "
      `);

      // Editing the file that is no longer imported must not rebuild the stylesheet nor notify the client.
      await c.expectNoWebSocketActivity(async () => {
        await dev.write("toggle-colors.css", `.colored { color: yellow; }`, { errors: null });
        await dev.write("toggle-colors.css", `.colored { color: blue; }`, { errors: null });
      });
      await c.style(".colored").notFound();
      expect(await servedCss(dev, "/toggle")).toBe(withoutImport);

      await dev.write(
        "toggle.css",
        `
          @import "./toggle-colors.css";
          .main { background: white; }
        `,
        { errors: null },
      );
      await c.style(".colored").color.expect.toBe("#00f");
      await c.style(".main").backgroundColor.expect.toBe("#fff");
      expect(await servedCss(dev, "/toggle")).toBe(withImport);
    }
  },
});

devTest("hot updates through shared imports, assets and script imports", {
  files: {
    // multiple stylesheets importing same dependency
    "shared-first.html": emptyHtmlFile({
      styles: ["shared-first.css"],
      body: `
        <div class="first">hello</div>
        <div class="shared">hello</div>
      `,
    }),
    "shared-second.html": emptyHtmlFile({
      styles: ["shared-second.css"],
      body: `
        <div class="second">hello</div>
        <div class="shared">hello</div>
      `,
    }),
    "shared-first.css": `
      @import "./shared.css";
      .first { color: red; }
    `,
    "shared-second.css": `
      @import "./shared.css";
      .second { color: blue; }
    `,
    "shared.css": `
      .shared { color: green; }
    `,
    // asset referenced in css
    "asset.html": emptyHtmlFile({ styles: ["asset.css"] }),
    "asset.css": `
      body {
        background-image: url(./asset.png);
      }
    `,
    "asset.png": imageFixtures.bun,
    // add new css import later
    "script.html": emptyHtmlFile({
      scripts: ["script.ts"],
      body: `hello world`,
    }),
    "script.ts": `
      // import "./script.css";
      export default function () {
        return "hello world";
      }
      import.meta.hot.accept();
    `,
    "script.css": `
      body {
        color: red;
      }
    `,
  },
  async test(dev) {
    // multiple stylesheets importing same dependency
    {
      await using c1 = await dev.client("/shared-first");
      await using c2 = await dev.client("/shared-second");
      await c1.style(".first").color.expect.toBe("red");
      await c2.style(".second").color.expect.toBe("#00f");
      await c1.style(".shared").color.expect.toBe("green");
      await c2.style(".shared").color.expect.toBe("green");
      expect(await servedCss(dev, "/shared-first")).toMatchInlineSnapshot(`
        "/* shared.css */
        .shared {
          color: green;
        }

        /* shared-first.css */
        .first {
          color: red;
        }
        "
      `);
      expect(await servedCss(dev, "/shared-second")).toMatchInlineSnapshot(`
        "/* shared.css */
        .shared {
          color: green;
        }

        /* shared-second.css */
        .second {
          color: #00f;
        }
        "
      `);

      await dev.write(
        "shared.css",
        `
          .shared { color: yellow; }
        `,
        { errors: null },
      );
      await c1.style(".shared").color.expect.toBe("#ff0");
      await c2.style(".shared").color.expect.toBe("#ff0");
      await c1.style(".first").color.expect.toBe("red");
      await c2.style(".second").color.expect.toBe("#00f");
      // Both roots were rebuilt on the server, not just patched in the clients.
      expect(await servedCss(dev, "/shared-first")).toMatchInlineSnapshot(`
        "/* shared.css */
        .shared {
          color: #ff0;
        }

        /* shared-first.css */
        .first {
          color: red;
        }
        "
      `);
      expect(await servedCss(dev, "/shared-second")).toMatchInlineSnapshot(`
        "/* shared.css */
        .shared {
          color: #ff0;
        }

        /* shared-second.css */
        .second {
          color: #00f;
        }
        "
      `);

      // The rebuild above bundled both stylesheets together; each must keep its edge to `shared.css`.
      await dev.write("shared.css", `.shared { color: red; }`, { errors: null });
      await c1.style(".shared").color.expect.toBe("red");
      await c2.style(".shared").color.expect.toBe("red");
    }

    // asset referenced in css
    {
      await using c = await dev.client("/asset");
      let backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      const stylesheet = await servedCss(dev, "/asset");
      await dev.fetch(extractCssUrl(stylesheet)).expectFile(imageFixtures.bun);
      expect(stylesheet).toContain("background-image:");
      expect(stylesheet).not.toContain("debugId");

      await dev.write("asset.png", imageFixtures.bun2, { errors: null });
      backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun2);
      await dev.fetch(extractCssUrl(await servedCss(dev, "/asset"))).expectFile(imageFixtures.bun2);
    }

    // add new css import later
    {
      await using c = await dev.client("/script");
      await c.style("body").notFound();
      expect(await stylesheetUrls(dev, "/script")).toStrictEqual([]);

      await dev.patch("script.ts", { find: "// import", replace: "import", errors: null });
      await c.style("body").color.expect.toBe("red");
      expect(await servedCss(dev, "/script")).toMatchInlineSnapshot(`
        "/* script.css */
        body {
          color: red;
        }
        "
      `);

      await dev.patch("script.ts", { find: "import", replace: "// import", errors: null });
      await c.style("body").notFound();
      expect(await stylesheetUrls(dev, "/script")).toStrictEqual([]);
    }
  },
});

devTest("bundling errors in stylesheets and recovering from them", {
  files: {
    // syntax error crash
    "crash.html": emptyHtmlFile({ styles: ["crash.css"], body: `hello world` }),
    "crash.css": `
      body {
        background-image: url
      }
    `,
    // css url resolve error on hot reload is recoverable
    "resolve.html": emptyHtmlFile({ styles: ["resolve.css"], body: `hello world` }),
    "resolve.css": `
      body {
        color: red;
      }
    `,
    // css file with syntax error does not kill old styles
    "keep.html": emptyHtmlFile({ styles: ["keep.css"], body: `hello world` }),
    "keep.css": `
      body {
        color: red;
      }
    `,
    // css file with initial syntax error gets recovered
    "initial.html": emptyHtmlFile({ styles: ["initial.css"], body: `hello world` }),
    "initial.css": `
      body {
        color: red;
      }}
    `,
  },
  async test(dev) {
    // syntax error crash
    {
      expect(await servedCss(dev, "/crash")).toMatchInlineSnapshot(`
        "/* crash.css */
        body {
          background-image: url;
        }
        "
      `);
      // previously: panic(main thread): Asset double unref: 0000000000000000
      await dev.patch("crash.css", { find: "url\n", replace: "url(\n" });
      await expectBuildFailed(dev, "/crash");
      await dev.write(
        "crash.css",
        `
          body {
            color: red;
          }
        `,
      );
      expect(await servedCss(dev, "/crash")).toMatchInlineSnapshot(`
        "/* crash.css */
        body {
          color: red;
        }
        "
      `);
    }

    // css url resolve error on hot reload is recoverable
    {
      {
        await using c = await dev.client("/resolve");
        await c.style("body").color.expect.toBe("red");
        // previously: panic: assertion failed: !chunk.content.is_css()
        await dev.write(
          "resolve.css",
          `
            body {
              background-image: url(./missing.png);
            }
          `,
          {
            errors: ['resolve.css:2:21: error: Could not resolve: "./missing.png"'],
          },
        );
        await c.style("body").color.expect.toBe("red");
      }
      // The client that had this page loaded is gone, see expectBuildFailed.
      await expectBuildFailed(dev, "/resolve");
      await dev.write(
        "resolve.css",
        `
          body {
            color: blue;
          }
        `,
      );
      expect(await servedCss(dev, "/resolve")).toMatchInlineSnapshot(`
        "/* resolve.css */
        body {
          color: #00f;
        }
        "
      `);
    }

    // css file with syntax error does not kill old styles
    {
      await using c = await dev.client("/keep");
      await c.style("body").color.expect.toBe("red");
      await dev.write(
        "keep.css",
        `
          body {
            color: red;
            background-color
          }
        `,
        {
          errors: ["keep.css:4:1: error: Unexpected end of input"],
        },
      );
      // Not fetched while broken: this client has the page loaded (see expectBuildFailed).
      await c.style("body").color.expect.toBe("red");

      await dev.write(
        "keep.css",
        `
          body {
            color: red;
            background-color: blue;
          }
        `,
      );
      await c.style("body").backgroundColor.expect.toBe("#00f");
      expect(await servedCss(dev, "/keep")).toMatchInlineSnapshot(`
        "/* keep.css */
        body {
          color: red;
          background-color: #00f;
        }
        "
      `);

      await dev.write("keep.css", ` `, { dedent: false, errors: null });
      await c.style("body").notFound();
      expect(await servedCss(dev, "/keep")).toMatchInlineSnapshot(`
        "/* keep.css */

        "
      `);
    }

    // css file with initial syntax error gets recovered
    {
      let blue: string;
      {
        await using c = await dev.client("/initial", {
          errors: ["initial.css:3:3: error: Unexpected end of input"],
        });
        // hard reload to dismiss the error overlay
        await c.expectReload(async () => {
          await dev.write(
            "initial.css",
            `
              body {
                color: red;
              }
            `,
          );
        });
        await c.style("body").color.expect.toBe("red");
        await dev.write(
          "initial.css",
          `
            body {
              color: blue;
            }
          `,
          { errors: null },
        );
        await c.style("body").color.expect.toBe("#00f");
        blue = await servedCss(dev, "/initial");
        expect(blue).toMatchInlineSnapshot(`
          "/* initial.css */
          body {
            color: #00f;
          }
          "
        `);
        await dev.write(
          "initial.css",
          `
            body {
              color: blue;
            }}
          `,
          {
            errors: ["initial.css:3:3: error: Unexpected end of input"],
          },
        );
      }
      // The client that had this page loaded is gone, see expectBuildFailed.
      await expectBuildFailed(dev, "/initial");
      // Recovering a second time serves the stylesheet again.
      await dev.write(
        "initial.css",
        `
          body {
            color: blue;
          }
        `,
      );
      expect(await servedCss(dev, "/initial")).toBe(blue);
    }
  },
});

devTest("stylesheets created after the server starts, changing html link tags", {
  files: {
    // css import before create
    "before.html": emptyHtmlFile({
      styles: ["before.css"],
      body: `
        <div>HELLO</div>
      `,
    }),
    // changing html file with link tag works
    "relink.html": emptyHtmlFile({ styles: ["relink.css"] }),
    "relink.css": `
      .test {
        color: blue;
        font-size: 24px;
      }
    `,
    // css import before create project relative: nested so "/style/..." differs from HTML-relative resolution
    "html/index.html": emptyHtmlFile({
      styles: ["/style/styles.css"],
      body: `
        <div>HELLO</div>
      `,
    }),
  },
  async test(dev) {
    // css import before create
    {
      await using c = await dev.client("/before", {
        errors: ['before.html: error: Could not resolve: "before.css". Maybe you need to "bun install"?'],
      });
      await expectBuildFailed(dev, "/before");
      await dev.write(
        "before.css",
        `
          body {
            background-image: url(before.png);
          }
        `,
        {
          errors: ['before.css:2:21: error: Could not resolve: "before.png". Maybe you need to "bun install"?'],
        },
      );
      await c.expectReload(async () => {
        await dev.write("before.png", imageFixtures.bun);
      });
      const backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      await dev.fetch("/before").expect.toContain("HELLO");
    }

    // changing html file with link tag works
    {
      await using c = await dev.client("/relink");
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      const testCss = await servedCss(dev, "/relink");
      expect(testCss).toMatchInlineSnapshot(`
        "/* relink.css */
        .test {
          color: #00f;
          font-size: 24px;
        }
        "
      `);

      // Rewriting the HTML file unchanged reloads the page; the stylesheet survives the rebuild.
      await c.expectReload(async () => {
        await dev.write("relink.html", dev.read("relink.html"), { dedent: false, errors: null });
      });
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      expect(await servedCss(dev, "/relink")).toBe(testCss);

      await dev.write("relink.html", emptyHtmlFile({ styles: ["relink-other.css"] }), {
        errors: ['relink.html: error: Could not resolve: "relink-other.css". Maybe you need to "bun install"?'],
      });
      // The HTML file itself fails, so fetching is safe with the page loaded; the page keeps its old stylesheet.
      await expectBuildFailed(dev, "/relink");
      await c.style(".test").color.expect.toBe("#00f");
      await c.expectReload(async () => {
        await dev.write(
          "relink-other.css",
          `
            .other {
              color: red;
            }
          `,
        );
      });
      await c.style(".other").color.expect.toBe("red");
      await c.style(".test").notFound();
      const otherCss = await servedCss(dev, "/relink");
      expect(otherCss).toMatchInlineSnapshot(`
        "/* relink-other.css */
        .other {
          color: red;
        }
        "
      `);

      await c.expectReload(async () => {
        await dev.write("relink.html", emptyHtmlFile({ styles: ["relink.css"] }), { errors: null });
      });
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      await c.style(".other").notFound();
      expect(await servedCss(dev, "/relink")).toBe(testCss);

      await c.expectReload(async () => {
        await dev.write("relink.html", emptyHtmlFile({ styles: ["relink-other.css", "relink.css"] }), {
          errors: null,
        });
      });
      await c.style(".other").color.expect.toBe("red");
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      // Each <link> becomes its own chunk; only the set is asserted here.
      const urls = await stylesheetUrls(dev, "/relink");
      const chunks = await Promise.all(urls.map(url => fetchCss(dev, url)));
      expect(chunks.sort()).toStrictEqual([otherCss, testCss].sort());
    }

    // css import before create project relative
    {
      dev.mkdir("style"); // (See DevServer.zig "BUN-10968")
      await using c = await dev.client("/html", {
        errors: ['html/index.html: error: Could not resolve: "/style/styles.css"'],
      });
      await expectBuildFailed(dev, "/html");
      await dev.write(
        "style/styles.css",
        `
          body {
            background-image: url(/assets/bun.png);
          }
        `,
        {
          errors: ['style/styles.css:2:21: error: Could not resolve: "/assets/bun.png"'],
        },
      );
      // An absolute url() in CSS is not resolved against the project root, so this file is not a dependency.
      await c.expectNoWebSocketActivity(async () => {
        await dev.write("assets/bun.png", imageFixtures.bun, { errors: null });
        await dev.delete("assets/bun.png", { errors: null });
      });
      await expectBuildFailed(dev, "/html");
      await dev.write(
        "style/styles.css",
        `
          body {
            background-image: url(../assets/bun.png);
          }
        `,
        {
          errors: ['style/styles.css:2:21: error: Could not resolve: "../assets/bun.png"'],
        },
      );
      await c.expectReload(async () => {
        await dev.write("assets/bun.png", imageFixtures.bun);
      });
      const backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      await dev.fetch("/html").expect.toContain("HELLO");
    }
  },
});

devTest("asset index stays valid after another css root is freed", {
  // Freeing the first root swap-removes its `DevServer.Assets` slot; the second root's `path_map` entry must follow.
  files: {
    "first.html": emptyHtmlFile({
      styles: ["first.css"],
      body: `<div class="first">hello</div>`,
    }),
    "second.html": emptyHtmlFile({
      styles: ["second.css"],
      body: `<div class="second">hello</div>`,
    }),
    "first.css": `
      .first { color: red; }
    `,
    "second.css": `
      .second { color: blue; }
    `,
  },
  async test(dev) {
    // Bundle /first before /second so `first.css` gets the lower asset index.
    expect(await servedCss(dev, "/first")).toMatchInlineSnapshot(`
      "/* first.css */
      .first {
        color: red;
      }
      "
    `);
    await using c2 = await dev.client("/second");
    await c2.style(".second").color.expect.toBe("#00f");
    expect(await servedCss(dev, "/second")).toMatchInlineSnapshot(`
      "/* second.css */
      .second {
        color: #00f;
      }
      "
    `);

    // Failing `first.css` swap-removes its asset slot, moving `second.css` into it.
    await dev.write(
      "first.css",
      `
        .first { color: red; }}
      `,
      { errors: null },
    );

    // Editing `second.css` looks up its `path_map` entry, previously stale (out-of-bounds read).
    await dev.write(
      "second.css",
      `
        .second { color: green; }
      `,
      { errors: null },
    );
    await c2.style(".second").color.expect.toBe("green");
    const greenSecond = await servedCss(dev, "/second");
    expect(greenSecond).toMatchInlineSnapshot(`
      "/* second.css */
      .second {
        color: green;
      }
      "
    `);

    // Fix the first file and ensure both pages still work afterwards.
    await dev.write(
      "first.css",
      `
        .first { color: yellow; }
      `,
    );
    await c2.style(".second").color.expect.toBe("green");
    expect(await servedCss(dev, "/second")).toBe(greenSecond);
    expect(await servedCss(dev, "/first")).toMatchInlineSnapshot(`
      "/* first.css */
      .first {
        color: #ff0;
      }
      "
    `);
  },
});

devTest("css hot update carries the edited stylesheet when another root fails in the same rebuild", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-plugin.ts"]
    `,
    "css-plugin.ts": `
      export default {
        name: "css-plugin",
        setup(build) {
          build.onResolve({ filter: /missing\\.png$/ }, () => undefined);
        },
      };
    `,
    "first.html": emptyHtmlFile({
      styles: ["first.css"],
      body: `<div class="first">hello</div>`,
    }),
    "second.html": emptyHtmlFile({
      styles: ["second.css"],
      body: `<div class="second">hello</div>`,
    }),
    "first.css": `
      .first { color: red; }
    `,
    "second.css": `
      .second { color: blue; }
    `,
  },
  async test(dev) {
    {
      await using c1 = await dev.client("/first");
      await c1.style(".first").color.expect.toBe("red");
      await c1.style(".second").notFound();

      await using c2 = await dev.client("/second");
      await c2.style(".second").color.expect.toBe("#00f");

      {
        await using batch = await dev.batchChanges({ errors: null });
        await dev.write(
          "first.css",
          `
            .first {
              background-image: url(./missing.png);
            }
          `,
        );
        await dev.write(
          "second.css",
          `
            .second { color: green; }
          `,
        );
      }
      await c2.style(".second").color.expect.toBe("green");
      await c1.style(".second").notFound();
      // The failed root keeps the rules it had before the rebuild.
      await c1.style(".first").color.expect.toBe("red");
    }
    const greenSecond = await servedCss(dev, "/second");
    expect(greenSecond).toMatchInlineSnapshot(`
      "/* second.css */
      .second {
        color: green;
      }
      "
    `);
    // Both clients are gone by now, see expectBuildFailed.
    await expectBuildFailed(dev, "/first");
    await dev.write(
      "first.css",
      `
        .first { color: yellow; }
      `,
    );
    expect(await servedCss(dev, "/second")).toBe(greenSecond);
    expect(await servedCss(dev, "/first")).toMatchInlineSnapshot(`
      "/* first.css */
      .first {
        color: #ff0;
      }
      "
    `);
  },
});

// The importer bundled alongside a failing stylesheet is what gets served once the stylesheet recovers.
devTest("importers bundled alongside a failing stylesheet serve correctly once it recovers", {
  files: {
    // html route strips its link tag
    "html.html": emptyHtmlFile({
      styles: ["html.css"],
      body: `<div class="a">hello</div>`,
    }),
    "html.css": `
      .a { color: red; }}
    `,
    // script importing a stylesheet still boots
    "script.html": emptyHtmlFile({
      scripts: ["script.ts"],
      body: `<div class="a">hello</div>`,
    }),
    "script.ts": `
      import "./script.css";
    `,
    "script.css": `
      .a { color: red; }}
    `,
  },
  async test(dev) {
    // html route strips its link tag when the stylesheet is bundled alongside a failing version of itself
    {
      // Masks the route script's URL, which embeds a generation number that changes every re-bundle.
      const routeHtml = async () => {
        const res = await dev.fetch("/html");
        expect(res.status).toBe(200);
        return (await res.text()).replace(/src="\/_bun\/client\/[^"]*"/, 'src="<route script>"');
      };
      await expectBuildFailed(dev, "/html");
      await dev.write("html.css", `.a { color: blue; }`);
      const recovered = await routeHtml();
      expect(recovered.match(/<link [^>]*>/g)).toStrictEqual([
        expect.stringMatching(/^<link rel="stylesheet" href="\/_bun\/asset\/[0-9a-f]{16}\.css">$/),
      ]);
      expect(await servedCss(dev, "/html")).toMatch(/color:\s*#00f/);

      // Syntax error, route requested while broken, then recovery.
      await dev.write("html.css", `.a { color: blue; }}`);
      await expectBuildFailed(dev, "/html");
      await dev.write("html.css", `.a { color: green; }`);
      expect(await routeHtml()).toBe(recovered);

      // A stylesheet that parses but fails import resolution, HTML file edited while broken, then recovery.
      await dev.write("html.css", `.a { background-image: url(./missing.png); }`);
      await dev.writeNoChanges("html.html");
      await dev.write("html.css", `.a { color: yellow; }`);
      expect(await routeHtml()).toBe(recovered);
    }

    // script importing a stylesheet still boots after the stylesheet fails and recovers
    {
      await expectBuildFailed(dev, "/script");
      await dev.write("script.css", `.a { color: blue; }`);
      {
        await using c = await dev.client("/script");
        await c.style(".a").color.expect.toBe("#00f");
      }

      await dev.write("script.css", `.a { color: blue; }}`);
      await expectBuildFailed(dev, "/script");
      await dev.write("script.css", `.a { color: green; }`);
      {
        await using c = await dev.client("/script");
        await c.style(".a").color.expect.toBe("green");
      }

      await dev.write("script.css", `.a { background-image: url(./missing.png); }`);
      await dev.writeNoChanges("script.ts");
      await dev.write("script.css", `.a { color: yellow; }`);
      {
        await using c = await dev.client("/script");
        await c.style(".a").color.expect.toBe("#ff0");
      }
    }
  },
});

// A stylesheet whose rebuild fails after parsing must keep the client's existing rules, like a syntax error does.
const failedRootKeepsOldStylesFiles = {
  "index.html": emptyHtmlFile({
    styles: ["styles.css"],
    body: `<div class="a">hello</div>`,
  }),
  "styles.css": `
    .a { color: red; }
  `,
};
devTest("css url that falls through a plugin onResolve and fails to resolve keeps old styles", {
  files: {
    ...failedRootKeepsOldStylesFiles,
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-plugin.ts"]
    `,
    "css-plugin.ts": `
      export default {
        name: "css-plugin",
        setup(build) {
          build.onResolve({ filter: /missing\\.png$/ }, () => undefined);
        },
      };
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".a").color.expect.toBe("red");
    await dev.write("styles.css", `.a { background-image: url(./missing.png); }`, {
      errors: ['styles.css:1:24: error: Could not resolve: "./missing.png"'],
    });
    await c.style(".a").color.expect.toBe("red");

    await dev.write("styles.css", `.a { color: green; }`);
    await c.style(".a").color.expect.toBe("green");
    expect((await dev.fetch("/")).status).toBe(200);
  },
});
devTest("css url whose plugin onResolve throws keeps old styles", {
  files: {
    ...failedRootKeepsOldStylesFiles,
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-plugin.ts"]
    `,
    "css-plugin.ts": `
      export default {
        name: "css-plugin",
        setup(build) {
          build.onResolve({ filter: /missing\\.png$/ }, () => {
            throw new Error("css-plugin rejected this url");
          });
        },
      };
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".a").color.expect.toBe("red");
    await dev.write("styles.css", `.a { background-image: url(./missing.png); }`, {
      errors: ["styles.css: error: css-plugin rejected this url"],
    });
    await c.style(".a").color.expect.toBe("red");

    await dev.write("styles.css", `.a { color: green; }`);
    await c.style(".a").color.expect.toBe("green");
    expect((await dev.fetch("/")).status).toBe(200);
  },
});
devTest("css root that imports a non-css file keeps old styles", {
  files: {
    ...failedRootKeepsOldStylesFiles,
    "not-css.js": `export const x = 1;`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".a").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        @import "./not-css.js";
        .a { color: blue; }
      `,
      {
        errors: ['styles.css:1:1: error: Cannot import a ".jsx" file into a CSS file'],
      },
    );
    await c.style(".a").color.expect.toBe("red");

    await dev.write("styles.css", `.a { color: green; }`);
    await c.style(".a").color.expect.toBe("green");
    expect((await dev.fetch("/")).status).toBe(200);
  },
});

// None of these `@import` anything, so the comment each served chunk starts with names the referenced file.
const orderedCssFiles = {
  "one.css": `.one { color: red; }`,
  "two.css": `.two { color: red; }`,
  "three.css": `.three { color: red; }`,
  "four.css": `.four { color: red; }`,
  "five.css": `.five { color: red; }`,
};
devTest("css roots keep their edges and are linked in source order", {
  files: {
    // html route links stylesheets in source order (#30488, #28117)
    "order.html": emptyHtmlFile({
      styles: ["one.css", "two.css", "three.css"],
      scripts: ["order.ts"],
    }),
    "order.ts": `
      import "./four.css";
      import "./five.css";
    `,
    ...orderedCssFiles,
    // stylesheets bundled together both update when a shared import changes
    "together.html": emptyHtmlFile({
      styles: ["together-a.css", "together-b.css"],
    }),
    "together-a.css": `
      @import "./together-shared.css";
      .a { color: red; }
    `,
    "together-b.css": `
      @import "./together-shared.css";
      .b { color: blue; }
    `,
    "together-shared.css": `
      .shared { color: green; }
    `,
    // stylesheet importing another linked stylesheet updates when it changes; base.css is linked first
    "linked.html": emptyHtmlFile({
      styles: ["base.css", "theme.css"],
    }),
    "base.css": `
      .base { color: green; }
    `,
    "theme.css": `
      @import "./base.css";
      .theme { color: blue; }
    `,
  },
  async test(dev) {
    // html route links stylesheets in source order
    {
      const linked = async () => stylesheetFileNames(dev, await stylesheetUrls(dev, "/order"));
      expect(await linked()).toStrictEqual(["one.css", "two.css", "three.css", "four.css", "five.css"]);

      // Rebuilding a file re-links the edges it already had in the same order.
      await dev.writeNoChanges("order.html");
      await dev.writeNoChanges("order.ts");
      expect(await linked()).toStrictEqual(["one.css", "two.css", "three.css", "four.css", "five.css"]);

      await dev.write(
        "order.html",
        emptyHtmlFile({
          styles: ["three.css", "one.css", "two.css"],
          scripts: ["order.ts"],
        }),
      );
      expect(await linked()).toStrictEqual(["three.css", "one.css", "two.css", "four.css", "five.css"]);

      await dev.write(
        "order.ts",
        `
          import "./five.css";
          import "./four.css";
        `,
      );
      expect(await linked()).toStrictEqual(["three.css", "one.css", "two.css", "five.css", "four.css"]);
    }

    // stylesheets bundled together both update when a shared import changes
    {
      expect(await linkedStylesheetColors(dev, "/together", ".shared")).toStrictEqual(["green", "green"]);
      await dev.write("together-shared.css", `.shared { color: yellow; }`);
      expect(await linkedStylesheetColors(dev, "/together", ".shared")).toStrictEqual(["#ff0", "#ff0"]);
      // The re-bundle above processed both roots together again; the edges must survive it.
      await dev.write("together-shared.css", `.shared { color: red; }`);
      expect(await linkedStylesheetColors(dev, "/together", ".shared")).toStrictEqual(["red", "red"]);
    }

    // stylesheet importing another linked stylesheet updates when it changes
    {
      expect(await linkedStylesheetColors(dev, "/linked", ".base")).toStrictEqual(["green", "green"]);
      await dev.write("base.css", `.base { color: yellow; }`);
      expect(await linkedStylesheetColors(dev, "/linked", ".base")).toStrictEqual(["#ff0", "#ff0"]);
    }
  },
});
devTest("framework route lists styles in source order", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      import "../one.css";
      import "../two.css";
      import "../three.css";
      export default function (req, meta) {
        return Response.json(meta.styles);
      }
    `,
    ...orderedCssFiles,
  },
  async test(dev) {
    const styles: string[] = await dev.fetch("/").json();
    expect(await stylesheetFileNames(dev, styles)).toStrictEqual(["one.css", "two.css", "three.css"]);
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}

const cssImports = (...files: string[]) => files.map(file => `import "../${file}";`).join("\n");
const routeRespondingWithStyles = (...cssFiles: string[]) => `
  ${cssImports(...cssFiles)}
  export default function (req, meta) {
    return Response.json(meta.styles);
  }
`;

// Nothing subscribes to hot updates until the last part, which used to leave the cached `meta.styles` in place forever.
devTest("framework route styles follow the css imports of the route and its layout", {
  framework: {
    ...minimalFramework,
    fileSystemRouterTypes: [{ ...minimalFramework.fileSystemRouterTypes[0], layouts: true }],
  },
  files: {
    "routes/_layout.ts": ``,
    "routes/index.ts": routeRespondingWithStyles("one.css"),
    "routes/other.ts": routeRespondingWithStyles(),
    "one.css": `.one { color: red; }`,
    "two.css": `.two { color: red; }`,
    "three.css": `.three { color: red; }`,
    "four.css": `.four { color: red; }`,
  },
  async test(dev) {
    expect(await routeStyles(dev, "/")).toStrictEqual(["one.css"]);
    expect(await routeStyles(dev, "/other")).toStrictEqual([]);

    await dev.write("routes/index.ts", routeRespondingWithStyles("one.css", "two.css"));
    const withTwo = await routeStyles(dev, "/");
    expect(withTwo.toSorted()).toStrictEqual(["one.css", "two.css"]);

    // Same edges, only their order changes.
    await dev.write("routes/index.ts", routeRespondingWithStyles("two.css", "one.css"));
    expect(await routeStyles(dev, "/")).toStrictEqual(withTwo.toReversed());

    await dev.write("routes/index.ts", routeRespondingWithStyles("two.css"));
    expect(await routeStyles(dev, "/")).toStrictEqual(["two.css"]);

    // The layout's stylesheets belong to both routes, and both have a cached list by now.
    await dev.write("routes/_layout.ts", cssImports("three.css"));
    expect((await routeStyles(dev, "/")).toSorted()).toStrictEqual(["three.css", "two.css"]);
    expect(await routeStyles(dev, "/other")).toStrictEqual(["three.css"]);

    // Now with a hot update subscriber looking at "/"; every rebuild publishes one hot update to it.
    using hmr = await viewRouteOverHmr(dev, "/");
    await dev.write("routes/other.ts", `export default function (`);
    await hmr.nextHotUpdate();
    await dev.write("routes/index.ts", routeRespondingWithStyles("four.css"));
    // While another route has a bundling error viewers only see the error, but the server-side styles are refreshed all the same.
    expect(await hmr.nextHotUpdate()).toStrictEqual({ reloadedRoutes: [], routeCss: {} });
    expect((await routeStyles(dev, "/")).toSorted()).toStrictEqual(["four.css", "three.css"]);

    await dev.write("routes/other.ts", routeRespondingWithStyles("one.css"));
    await hmr.nextHotUpdate();
    expect((await routeStyles(dev, "/other")).toSorted()).toStrictEqual(["one.css", "three.css"]);

    // With the error gone, the viewer of "/" is told to reload it and which stylesheets it has now.
    await dev.write("routes/index.ts", routeRespondingWithStyles());
    const update = await hmr.nextHotUpdate();
    const hrefs: string[] = await dev.fetch("/").json();
    expect(await stylesheetFileNames(dev, hrefs)).toStrictEqual(["three.css"]);
    expect(update).toStrictEqual({
      reloadedRoutes: [hmr.routeBundleIndex],
      routeCss: { [hmr.routeBundleIndex]: hrefs.map(href => href.match(/^\/_bun\/asset\/([0-9a-f]{16})\.css$/)![1]) },
    });
  },
});

/** Fetches a route written with `routeRespondingWithStyles` and resolves the stylesheets to file names. */
async function routeStyles(dev: Dev, route: string): Promise<string[]> {
  return stylesheetFileNames(dev, await dev.fetch(route).json());
}

/** The route lists at the start of a hot update payload (see "List 1" and "List 2" in DevServer.rs's finalize_bundle). */
interface HotUpdateRouteLists {
  /** Route bundles whose server-side code changed; viewers re-request them. */
  reloadedRoutes: number[];
  /** For each viewed route bundle that changed, its stylesheet ids, or `null` if no import was added or removed. */
  routeCss: Record<number, string[] | null>;
}

function decodeRouteLists(payload: ArrayBuffer): HotUpdateRouteLists {
  const view = new DataView(payload);
  let offset = 1; // MessageId.hot_update
  const i32 = () => {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };
  const reloadedRoutes: number[] = [];
  for (let route = i32(); route !== -1; route = i32()) {
    reloadedRoutes.push(route);
  }
  const routeCss: Record<number, string[] | null> = {};
  for (let route = i32(); route !== -1; route = i32()) {
    const count = i32();
    if (count === -1) {
      routeCss[route] = null;
      continue;
    }
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(Buffer.from(payload, offset, 16).toString());
      offset += 16;
    }
    routeCss[route] = ids;
  }
  return { reloadedRoutes, routeCss };
}

/** Performs the browser HMR handshake (subscribe to hot updates and errors, set the viewed route); resolves once the route is acknowledged. */
async function viewRouteOverHmr(dev: Dev, route: string) {
  const ws = new WebSocket(dev.baseUrl + "/_bun/hmr");
  ws.binaryType = "arraybuffer";
  const viewing = Promise.withResolvers<number>();
  const unreadHotUpdates: ArrayBuffer[] = [];
  let reader: PromiseWithResolvers<ArrayBuffer> | null = null;
  let failure: Error | null = null;
  const fail = (reason: string) => {
    failure = new Error(reason);
    viewing.reject(failure);
    reader?.reject(failure);
  };
  ws.onerror = () => fail("hmr websocket errored");
  ws.onclose = () => fail("hmr websocket closed");
  ws.onmessage = event => {
    const payload = event.data as ArrayBuffer;
    switch (new Uint8Array(payload)[0]) {
      case "V".charCodeAt(0): // version
        ws.send("she"); // subscribe to hot updates and errors
        ws.send("n" + route); // set_url
        break;
      case "n".charCodeAt(0): // set_url_response
        viewing.resolve(new DataView(payload).getUint32(1, true));
        break;
      case "u".charCodeAt(0): // hot_update
        if (reader) {
          reader.resolve(payload);
          reader = null;
        } else {
          unreadHotUpdates.push(payload);
        }
        break;
    }
  };
  return {
    routeBundleIndex: await viewing.promise,
    async nextHotUpdate(): Promise<HotUpdateRouteLists> {
      let payload = unreadHotUpdates.shift();
      if (!payload) {
        if (failure) throw failure;
        reader = Promise.withResolvers<ArrayBuffer>();
        payload = await reader.promise;
      }
      return decodeRouteLists(payload);
    },
    [Symbol.dispose]() {
      ws.onclose = null;
      ws.close();
    },
  };
}

// Scripts are enqueued before styles, so the extra hop gives `b.js` a higher source index than `a.css`.
devTest("failed css root imported by a later script gets no chunk", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["a.css"],
      scripts: ["c.js"],
      body: `<div class="a">hello</div>`,
    }),
    "a.css": `
      @import "./not-css.js";
      .a { color: red; }
    `,
    "c.js": `import "./b.js";`,
    "b.js": `import "./a.css";`,
    "not-css.js": `export const x = 1;`,
  },
  async test(dev) {
    await expectBuildFailed(dev, "/");
    // The first response replays the bundle's failure list; the second consults the graph, where a chunk would mask it.
    await expectBuildFailed(dev, "/");
    await dev.write("a.css", `.a { color: blue; }`);
    await using c = await dev.client("/");
    await c.style(".a").color.expect.toBe("#00f");
  },
});
