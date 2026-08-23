// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import assert from "node:assert";
import { devTest, devTestGroup, emptyHtmlFile, imageFixtures } from "../bake-harness";

// Every case below gets its own route and directory on one dev server, so the
// file pays for one dev server process instead of one per case. A case must
// leave its files valid: the server reports every failure it still holds on
// the next error page, whichever route the failing file belongs to.
devTestGroup("shared dev server", {}, test => {
  test("css file with syntax error does not kill old styles", {
    files: {
      "syntax-error/styles.css": `
        body {
          color: red;
        }
      `,
      "syntax-error/index.html": emptyHtmlFile({
        styles: ["styles.css"],
        body: `hello world`,
      }),
    },
    async test(dev) {
      await using c = await dev.client("/syntax-error");
      await c.style("body").color.expect.toBe("red");
      await dev.write(
        "syntax-error/styles.css",
        `
          body {
            color: red;
            background-color
          }
        `,
        {
          errors: ["syntax-error/styles.css:4:1: error: Unexpected end of input"],
        },
      );
      // The old stylesheet stays in place, including the absence of the new rule.
      await c.style("body").color.expect.toBe("red");
      await c.style("body").backgroundColor.expect.toBeUndefined();
      await dev.write(
        "syntax-error/styles.css",
        `
          body {
            color: red;
            background-color: blue;
          }
        `,
      );
      await c.style("body").backgroundColor.expect.toBe("#00f");
      await dev.write("syntax-error/styles.css", ` `, { dedent: false });
      await c.style("body").notFound();
    },
  });
  test("css file with initial syntax error gets recovered", {
    files: {
      "initial-syntax-error/index.html": emptyHtmlFile({
        styles: ["styles.css"],
        body: `hello world`,
      }),
      "initial-syntax-error/styles.css": `
        body {
          color: red;
        }}
      `,
    },
    async test(dev) {
      await using c = await dev.client("/initial-syntax-error", {
        errors: ["initial-syntax-error/styles.css:3:3: error: Unexpected end of input"],
      });
      // hard reload to dismiss the error overlay
      await c.expectReload(async () => {
        await dev.write(
          "initial-syntax-error/styles.css",
          `
            body {
              color: red;
            }
          `,
        );
      });
      await c.style("body").color.expect.toBe("red");
      await dev.write(
        "initial-syntax-error/styles.css",
        `
          body {
            color: blue;
          }
        `,
      );
      await c.style("body").color.expect.toBe("#00f");
      await dev.write(
        "initial-syntax-error/styles.css",
        `
          body {
            color: blue;
          }}
        `,
        {
          errors: ["initial-syntax-error/styles.css:3:3: error: Unexpected end of input"],
        },
      );
      // A second recovery, this time on a page that is already loaded, is a
      // hot update rather than a reload.
      await c.style("body").color.expect.toBe("#00f");
      await dev.write(
        "initial-syntax-error/styles.css",
        `
          body {
            color: green;
          }
        `,
      );
      await c.style("body").color.expect.toBe("green");
    },
  });
  test("add new css import later", {
    files: {
      "add-import-later/index.html": emptyHtmlFile({
        scripts: ["index.ts"],
        body: `hello world`,
      }),
      "add-import-later/index.ts": `
        // import "./styles.css";
        export default function () {
          return "hello world";
        }
        import.meta.hot.accept();
      `,
      "add-import-later/styles.css": `
        body {
          color: red;
        }
      `,
    },
    async test(dev) {
      await using c = await dev.client("/add-import-later");
      await c.style("body").notFound();
      await dev.patch("add-import-later/index.ts", { find: "// import", replace: "import" });
      await c.style("body").color.expect.toBe("red");
      await dev.patch("add-import-later/index.ts", { find: "import", replace: "// import" });
      await c.style("body").notFound();
    },
  });
  test("css import another css file", {
    files: {
      "import-another/index.html": emptyHtmlFile({
        styles: ["styles.css"],
      }),
      "import-another/styles.css": `
        @import "./second.css";
        body {
          color: red;
        }
      `,
      "import-another/second.css": `
        h1 {
          color: blue;
        }
      `,
    },
    async test(dev) {
      await using c = await dev.client("/import-another");
      // Verify initial build
      await c.style("h1").color.expect.toBe("#00f");
      await c.style("body").color.expect.toBe("red");

      // Hot reload
      await dev.write(
        "import-another/second.css",
        `
          h1 {
            color: green;
          }
        `,
      );
      await c.style("h1").color.expect.toBe("green");
      await c.style("body").color.expect.toBe("red");

      // Check that the styles still work after a reload
      await c.hardReload();
      await c.style("h1").color.expect.toBe("green");
      await c.style("body").color.expect.toBe("red");
    },
  });
  test("asset referenced in css", {
    files: {
      "asset-in-css/index.html": emptyHtmlFile({
        styles: ["styles.css"],
      }),
      "asset-in-css/styles.css": `
        body {
          background-image: url(./bun.png);
        }
      `,
      "asset-in-css/bun.png": imageFixtures.bun,
    },
    async test(dev) {
      await using c = await dev.client("/asset-in-css");
      let backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      // The served stylesheet is the chunk with the asset reference resolved and
      // nothing else: CSS never gets a source map, so no debugId trailer either.
      const stylesheetHref = (await dev.fetch("/asset-in-css").text()).match(
        /<link rel="stylesheet"[^>]*href="([^"]+)"/,
      )![1];
      await dev
        .fetch(stylesheetHref)
        .expect.toBe(
          `/* asset-in-css/styles.css */\nbody {\n  background-image: url(${JSON.stringify(extractCssUrl(backgroundImage))});\n}\n`,
        );
      await dev.write("asset-in-css/bun.png", imageFixtures.bun2);
      const updatedBackgroundImage = await c.style("body").backgroundImage;
      assert(updatedBackgroundImage);
      expect(updatedBackgroundImage).not.toBe(backgroundImage);
      await dev.fetch(extractCssUrl(updatedBackgroundImage)).expectFile(imageFixtures.bun2);
    },
  });
  test("syntax error crash", {
    files: {
      "syntax-error-crash/styles.css": `
        body {
          background-image: url
        }
      `,
      "syntax-error-crash/index.html": emptyHtmlFile({
        styles: ["styles.css"],
        body: `hello world`,
      }),
    },
    async test(dev) {
      const initial = await dev.fetch("/syntax-error-crash");
      expect(initial.status).toBe(200);
      expect(await initial.text()).toContain("hello world");
      // previously: panic(main thread): Asset double unref: 0000000000000000
      await dev.patch("syntax-error-crash/styles.css", { find: "url\n", replace: "url(\n" });
      const failed = await dev.fetch("/syntax-error-crash");
      expect(failed.status).toBe(500);
      expect(await failed.text()).toContain("<title>Bun - Build Failed</title>");
      // The route recovers once the file parses again.
      await dev.patch("syntax-error-crash/styles.css", { find: "url(\n", replace: "url\n" });
      const recovered = await dev.fetch("/syntax-error-crash");
      expect(recovered.status).toBe(200);
      expect(await recovered.text()).toContain("hello world");
    },
  });
  test("css url resolve error on hot reload is recoverable", {
    files: {
      "url-resolve-error/styles.css": `
        body {
          color: red;
        }
      `,
      "url-resolve-error/index.html": emptyHtmlFile({
        styles: ["styles.css"],
        body: `hello world`,
      }),
    },
    async test(dev) {
      {
        await using c = await dev.client("/url-resolve-error");
        await c.style("body").color.expect.toBe("red");
        // A CSS file that parses but fails import resolution must fail the
        // rebuild with an error instead of being treated as a valid CSS chunk.
        // previously: panic: assertion failed: !chunk.content.is_css()
        await dev.write(
          "url-resolve-error/styles.css",
          `
            body {
              background-image: url(./missing.png);
            }
          `,
          {
            errors: ['url-resolve-error/styles.css:2:21: error: Could not resolve: "./missing.png"'],
          },
        );
      }
      // The failing route is fetched and recovered without a connected client: a
      // fetch re-bundles the route, and both that and the recovery ship the HTML
      // route as a JS module without the route-reload flag, which trips a
      // client-side debug assert (tracked in https://github.com/oven-sh/bun/issues/31908).
      const failed = await dev.fetch("/url-resolve-error");
      expect(failed.status).toBe(500);
      expect(await failed.text()).toContain("<title>Bun - Build Failed</title>");
      await dev.write(
        "url-resolve-error/styles.css",
        `
          body {
            color: blue;
          }
        `,
      );
      const recovered = await dev.fetch("/url-resolve-error");
      expect(recovered.status).toBe(200);
      expect(await recovered.text()).toContain("hello world");
    },
  });
  test("circular css imports handle hot reload", {
    files: {
      "circular/index.html": emptyHtmlFile({
        styles: ["a.css"],
        body: `
          <div class="a">hello</div>
          <div class="b">hello</div>
        `,
      }),
      "circular/a.css": `
        @import "./b.css";
        .a { color: red; }
      `,
      "circular/b.css": `
        @import "./a.css";
        .b { color: blue; }
      `,
    },
    async test(dev) {
      await using client = await dev.client("/circular");
      await client.style(".a").color.expect.toBe("red");
      await client.style(".b").color.expect.toBe("#00f");

      // Modify one of the circular dependencies
      await dev.write(
        "circular/a.css",
        `
          @import "./b.css";
          .a { color: green; }
        `,
      );
      await client.style(".a").color.expect.toBe("green");
      await client.style(".b").color.expect.toBe("#00f");
    },
  });
  test("asset index stays valid after another css root is freed", {
    // Two independent CSS roots each get an entry in `DevServer.Assets`.
    // When the first one is freed (via a syntax error), its slot is removed
    // with `swapRemoveAt`, which moves the last entry into the first slot.
    // The second CSS file's `path_map` entry must be patched to the new slot
    // so the next edit does not read past the end of the asset array.
    files: {
      "asset-index/first.html": emptyHtmlFile({
        styles: ["first.css"],
        body: `<div class="first">hello</div>`,
      }),
      "asset-index/second.html": emptyHtmlFile({
        styles: ["second.css"],
        body: `<div class="second">hello</div>`,
      }),
      "asset-index/first.css": `
        .first { color: red; }
      `,
      "asset-index/second.css": `
        .second { color: blue; }
      `,
    },
    async test(dev) {
      // Bundle /first before /second so that `first.css` is registered at
      // a lower asset index than `second.css`, and `second.css` is the last
      // asset when `first.css` is freed.
      {
        await using c1 = await dev.client("/asset-index/first");
        await c1.style(".first").color.expect.toBe("red");
      }
      await using c2 = await dev.client("/asset-index/second");
      await c2.style(".second").color.expect.toBe("#00f");

      // Failing `first.css` frees its asset slot via `unrefByPath`, which
      // swap-removes it and moves the data for `second.css` into its slot.
      await dev.write(
        "asset-index/first.css",
        `
          .first { color: red; }}
        `,
        { errors: null },
      );

      // Editing `second.css` now goes through `replacePath`, which looks up
      // its `path_map` entry. Previously this index was stale (pointed at
      // `files.len`), causing an out-of-bounds read into `refs`/`files`.
      await dev.write(
        "asset-index/second.css",
        `
          .second { color: green; }
        `,
        { errors: null },
      );
      await c2.style(".second").color.expect.toBe("green");

      // Fix the first file and ensure both pages still work afterwards.
      await dev.write(
        "asset-index/first.css",
        `
          .first { color: yellow; }
        `,
      );
      await c2.style(".second").color.expect.toBe("green");
      {
        await using c1 = await dev.client("/asset-index/first");
        await c1.style(".first").color.expect.toBe("#ff0");
      }
    },
  });
  test("multiple stylesheets importing same dependency", {
    files: {
      "shared-dep/first.html": emptyHtmlFile({
        styles: ["first.css"],
        body: `
          <div class="first">hello</div>
          <div class="shared">hello</div>
        `,
      }),
      "shared-dep/second.html": emptyHtmlFile({
        styles: ["second.css"],
        body: `
          <div class="second">hello</div>
          <div class="shared">hello</div>
        `,
      }),
      "shared-dep/first.css": `
        @import "./shared.css";
        .first { color: red; }
      `,
      "shared-dep/second.css": `
        @import "./shared.css";
        .second { color: blue; }
      `,
      "shared-dep/shared.css": `
        .shared { color: green; }
      `,
    },
    async test(dev) {
      await using c1 = await dev.client("/shared-dep/first");
      await using c2 = await dev.client("/shared-dep/second");
      await c1.style(".first").color.expect.toBe("red");
      await c2.style(".second").color.expect.toBe("#00f");
      await c1.style(".shared").color.expect.toBe("green");
      await c2.style(".shared").color.expect.toBe("green");

      await dev.write(
        "shared-dep/shared.css",
        `
          .shared { color: yellow; }
        `,
      );

      // Both importers pick up the change and keep their own rules.
      await c1.style(".shared").color.expect.toBe("#ff0");
      await c2.style(".shared").color.expect.toBe("#ff0");
      await c1.style(".first").color.expect.toBe("red");
      await c2.style(".second").color.expect.toBe("#00f");
    },
  });
  test("removing and re-adding css import", {
    files: {
      "readd-import/index.html": emptyHtmlFile({
        styles: ["main.css"],
      }),
      "readd-import/main.css": `
        @import "./colors.css";
        .main { background: white; }
      `,
      "readd-import/colors.css": `
        .colored { color: blue; }
      `,
    },
    async test(dev) {
      await using c = await dev.client("/readd-import");
      await c.style(".colored").color.expect.toBe("#00f");

      // Remove the import
      await dev.write(
        "readd-import/main.css",
        `
          /* @import "./colors.css"; */
          .main { background: white; }
        `,
      );
      await c.style(".colored").notFound();

      // A change to 'colors.css' should not trigger a rebuild of 'main.css', nor notify any clients.
      await c.expectNoWebSocketActivity(async () => {
        await dev.write(
          "readd-import/colors.css",
          `
            .colored { color: yellow; }
          `,
        );
        await dev.write(
          "readd-import/colors.css",
          `
            .colored { color: blue; }
          `,
        );
      });
      await c.style(".colored").notFound();

      // Re-add the import
      await dev.write(
        "readd-import/main.css",
        `
          @import "./colors.css";
          .main { background: white; }
        `,
      );
      await c.style(".colored").color.expect.toBe("#00f");
      await c.style(".main").backgroundColor.expect.toBe("#fff");
    },
  });
  test("changing html file with link tag works", {
    files: {
      "link-tag/index.html": emptyHtmlFile({
        styles: ["styles.css"],
      }),
      "link-tag/styles.css": `
        .test {
          color: blue;
          font-size: 24px;
        }
      `,
    },
    async test(dev) {
      await using c = await dev.client("/link-tag");
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");

      await c.expectReload(async () => {
        await dev.writeNoChanges("link-tag/index.html");
      });
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");

      await c.hardReload();
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");

      await dev.write(
        "link-tag/index.html",
        emptyHtmlFile({
          styles: ["other.css"],
        }),
        {
          errors: ['link-tag/index.html: error: Could not resolve: "other.css". Maybe you need to "bun install"?'],
        },
      );
      await c.expectReload(async () => {
        await dev.write(
          "link-tag/other.css",
          `
            .other {
              color: red;
            }
          `,
        );
      });
      await c.style(".other").color.expect.toBe("red");
      await c.style(".test").notFound();
      await c.expectReload(async () => {
        await dev.write(
          "link-tag/index.html",
          emptyHtmlFile({
            styles: ["styles.css"],
          }),
        );
      });
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
      await c.style(".other").notFound();
      await c.expectReload(async () => {
        await dev.write(
          "link-tag/index.html",
          emptyHtmlFile({
            styles: ["other.css", "styles.css"],
          }),
        );
      });
      await c.style(".other").color.expect.toBe("red");
      await c.style(".test").color.expect.toBe("#00f");
      await c.style(".test").fontSize.expect.toBe("24px");
    },
  });
  test("css import before create", {
    files: {
      "before-create/index.html": emptyHtmlFile({
        styles: ["styles.css"],
        body: `
          <div>HELLO</div>
        `,
      }),
    },
    async test(dev) {
      await using c = await dev.client("/before-create", {
        errors: ['before-create/index.html: error: Could not resolve: "styles.css". Maybe you need to "bun install"?'],
      });
      const failed = await dev.fetch("/before-create");
      expect(failed.status).toBe(500);
      expect(await failed.text()).not.toContain("HELLO");
      await dev.write(
        "before-create/styles.css",
        `
          body {
            background-image: url(bun.png);
          }
        `,
        {
          errors: [
            'before-create/styles.css:2:21: error: Could not resolve: "bun.png". Maybe you need to "bun install"?',
          ],
        },
      );
      await c.expectReload(async () => {
        await dev.write("before-create/bun.png", imageFixtures.bun);
      });
      const backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      const recovered = await dev.fetch("/before-create");
      expect(recovered.status).toBe(200);
      expect(await recovered.text()).toContain("HELLO");
    },
  });
  test("css import before create project relative", {
    files: {
      "project-relative/html/index.html": emptyHtmlFile({
        styles: ["/project-relative/style/styles.css"],
        body: `
          <div>HELLO</div>
        `,
      }),
    },
    async test(dev) {
      dev.mkdir("project-relative/style"); // (See DevServer "BUN-10968")
      await using c = await dev.client("/project-relative/html", {
        errors: ['project-relative/html/index.html: error: Could not resolve: "/project-relative/style/styles.css"'],
      });
      const failed = await dev.fetch("/project-relative/html");
      expect(failed.status).toBe(500);
      expect(await failed.text()).not.toContain("HELLO");
      await dev.write(
        "project-relative/style/styles.css",
        `
          body {
            background-image: url(/project-relative/assets/bun.png);
          }
        `,
        {
          errors: [
            'project-relative/style/styles.css:2:21: error: Could not resolve: "/project-relative/assets/bun.png"',
          ],
        },
      );
      await c.expectNoWebSocketActivity(async () => {
        await dev.write("project-relative/assets/bun.png", imageFixtures.bun, { errors: null });
        await dev.delete("project-relative/assets/bun.png", { errors: null });
      });
      await dev.fetch("/project-relative/html").expect.not.toContain("HELLO");
      await dev.write(
        "project-relative/style/styles.css",
        `
          body {
            background-image: url(../assets/bun.png);
          }
        `,
        {
          errors: ['project-relative/style/styles.css:2:21: error: Could not resolve: "../assets/bun.png"'],
        },
      );
      await c.expectReload(async () => {
        await dev.write("project-relative/assets/bun.png", imageFixtures.bun);
      });
      const backgroundImage = await c.style("body").backgroundImage;
      assert(backgroundImage);
      await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
      const recovered = await dev.fetch("/project-relative/html");
      expect(recovered.status).toBe(200);
      expect(await recovered.text()).toContain("HELLO");
    },
  });
});

// The resolver plugin applies to every route of a server, so this case keeps
// its own server.
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

    await dev.write(
      "first.css",
      `
        .first { color: yellow; }
      `,
    );
    {
      await using c2 = await dev.client("/second");
      await c2.style(".second").color.expect.toBe("green");
    }
    {
      await using c1 = await dev.client("/first");
      await c1.style(".first").color.expect.toBe("#ff0");
    }
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
