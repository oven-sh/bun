// CSS tests concern bundling bugs with CSS files.
//
// Starting a dev server and a browser client each cost a process spawn, so
// independent cases share one dev server: one route per case, each case
// leaves its route working. A comment names the case each block covers.
import { expect } from "bun:test";
import assert from "node:assert";
import type { Dev } from "../bake-harness";
import { devTest, emptyHtmlFile, imageFixtures } from "../bake-harness";

/** The stylesheet URLs the dev server injected into an HTML route (source `<link>` tags are ignored). */
async function stylesheetUrls(dev: Dev, route: string): Promise<string[]> {
  const res = await dev.fetch(route);
  const html = await res.text();
  expect(res.status).toBe(200);
  return [...html.matchAll(/<link rel="stylesheet" href="(\/_bun\/asset\/[0-9a-f]{16}\.css)">/g)].map(m => m[1]);
}

async function fetchCss(dev: Dev, url: string): Promise<string> {
  const res = await dev.fetch(url);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/css;charset=utf-8");
  return res.text();
}

/** The exact stylesheet served for a route that links exactly one stylesheet. */
async function servedCss(dev: Dev, route: string): Promise<string> {
  const urls = await stylesheetUrls(dev, route);
  expect(urls).toHaveLength(1);
  return fetchCss(dev, urls[0]);
}

/** Replaces an inlined image fixture with its name so a snapshot stays readable. */
function redactInlineAssets(css: string): string {
  return css
    .replaceAll(imageFixtures.bun.toString("base64"), "<bun.png>")
    .replaceAll(imageFixtures.bun2.toString("base64"), "<bun2.png>");
}

/**
 * Expects the error page. A fetch of a failing route re-bundles it, which
 * confuses a connected client that has the route's real page loaded (#31908),
 * so only call it when no such client exists or when the HTML file itself fails.
 */
async function expectBuildFailed(dev: Dev, route: string) {
  const res = await dev.fetch(route);
  expect(await res.text()).toContain("<title>Bun - Build Failed</title>");
  expect(res.status).toBe(500);
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

      // Check that the styles still work after a reload
      await c.hardReload();
      await c.style("h1").color.expect.toBe("green");
      await c.style("body").color.expect.toBe("red");
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

      // Modify one of the circular dependencies
      await dev.write(
        "circular-a.css",
        `
          @import "./circular-b.css";
          .a { color: green; }
        `,
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

      // Remove the import
      await dev.write(
        "toggle.css",
        `
          /* @import "./toggle-colors.css"; */
          .main { background: white; }
        `,
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

      // A change to the file that is no longer imported must not rebuild the
      // stylesheet nor notify any clients.
      await c.expectNoWebSocketActivity(async () => {
        await dev.write("toggle-colors.css", `.colored { color: yellow; }`);
        await dev.write("toggle-colors.css", `.colored { color: blue; }`);
      });
      await c.style(".colored").notFound();
      expect(await servedCss(dev, "/toggle")).toBe(withoutImport);

      // Re-add the import
      await dev.write(
        "toggle.css",
        `
          @import "./toggle-colors.css";
          .main { background: white; }
        `,
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
    }

    // asset referenced in css
    {
      await using c = await dev.client("/asset");
      let backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      // The served stylesheet is the chunk with the asset inlined and nothing
      // else: CSS never gets a source map, so no debugId trailer either.
      expect(redactInlineAssets(await servedCss(dev, "/asset"))).toMatchInlineSnapshot(`
        "/* asset.css */
        body {
          background-image: url("data:image/png;base64,<bun.png>");
        }
        "
      `);

      await dev.write("asset.png", imageFixtures.bun2);
      backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun2);
      expect(redactInlineAssets(await servedCss(dev, "/asset"))).toMatchInlineSnapshot(`
        "/* asset.css */
        body {
          background-image: url("data:image/png;base64,<bun2.png>");
        }
        "
      `);
    }

    // add new css import later
    {
      await using c = await dev.client("/script");
      await c.style("body").notFound();
      expect(await stylesheetUrls(dev, "/script")).toStrictEqual([]);

      await dev.patch("script.ts", { find: "// import", replace: "import" });
      await c.style("body").color.expect.toBe("red");
      expect(await servedCss(dev, "/script")).toMatchInlineSnapshot(`
        "/* script.css */
        body {
          color: red;
        }
        "
      `);

      await dev.patch("script.ts", { find: "import", replace: "// import" });
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
      // `url` without parentheses is a plain identifier value.
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
        // A CSS file that parses but fails import resolution must fail the
        // rebuild with an error instead of being treated as a valid CSS chunk.
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
      // The failing route is fetched and recovered without a connected client:
      // a fetch re-bundles the route, and both that and the recovery ship the
      // HTML route as a JS module without the route-reload flag, which trips a
      // client-side debug assert (tracked in https://github.com/oven-sh/bun/issues/31908).
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

      await dev.write("keep.css", ` `, { dedent: false });
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
        // The client loaded the error page, not the route's page, so a fetch is safe.
        await expectBuildFailed(dev, "/initial");
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
        await c.style("body").color.expect.toBe("#00f");
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
      await expectBuildFailed(dev, "/before");
      await c.expectReload(async () => {
        await dev.write("before.png", imageFixtures.bun);
      });
      const backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      await dev.fetch("/before").expect.toContain("HELLO");
      expect(redactInlineAssets(await servedCss(dev, "/before"))).toMatchInlineSnapshot(`
        "/* before.css */
        body {
          background-image: url("data:image/png;base64,<bun.png>");
        }
        "
      `);
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
        await dev.writeNoChanges("relink.html");
      });
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      expect(await servedCss(dev, "/relink")).toBe(testCss);

      await c.hardReload();
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");

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
        await dev.write("relink.html", emptyHtmlFile({ styles: ["relink.css"] }));
      });
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      await c.style(".other").notFound();
      expect(await servedCss(dev, "/relink")).toBe(testCss);

      await c.expectReload(async () => {
        await dev.write("relink.html", emptyHtmlFile({ styles: ["relink-other.css", "relink.css"] }));
      });
      await c.style(".other").color.expect.toBe("red");
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      // Each <link> becomes its own chunk. The graph trace decides the order
      // they are linked in, so only the set is asserted here.
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
      expect(redactInlineAssets(await servedCss(dev, "/html"))).toMatchInlineSnapshot(`
        "/* style/styles.css */
        body {
          background-image: url("data:image/png;base64,<bun.png>");
        }
        "
      `);
    }
  },
});

devTest("asset index stays valid after another css root is freed", {
  // Two independent CSS roots each get an entry in `DevServer.Assets`.
  // When the first one is freed (via a syntax error), its slot is removed
  // with `swapRemoveAt`, which moves the second entry into the first slot.
  // The second CSS file's `path_map` entry must be patched to the new slot
  // so the next edit does not read past the end of the asset array.
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
    // Bundle /first before /second so that `first.css` is registered at
    // a lower asset index than `second.css`.
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

    // Failing `first.css` frees its asset slot via `unrefByPath`, which
    // swap-removes it and moves the data for `second.css` into its slot.
    await dev.write(
      "first.css",
      `
        .first { color: red; }}
      `,
      { errors: null },
    );

    // Editing `second.css` now goes through `replacePath`, which looks up
    // its `path_map` entry. Previously this index was stale (pointed at
    // `files.len`), causing an out-of-bounds read into `refs`/`files`.
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
    }
    // Both clients are gone, see expectBuildFailed.
    await expectBuildFailed(dev, "/first");
    const greenSecond = await servedCss(dev, "/second");
    expect(greenSecond).toMatchInlineSnapshot(`
      "/* second.css */
      .second {
        color: green;
      }
      "
    `);

    await dev.write(
      "first.css",
      `
        .first { color: yellow; }
      `,
    );
    expect(await servedCss(dev, "/second")).toBe(greenSecond);
    {
      await using c1 = await dev.client("/first");
      await c1.style(".first").color.expect.toBe("#ff0");
    }
    expect(await servedCss(dev, "/first")).toMatchInlineSnapshot(`
      "/* first.css */
      .first {
        color: #ff0;
      }
      "
    `);
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
