// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import assert from "node:assert";
import { devTest, emptyHtmlFile, imageFixtures, minimalFramework } from "../bake-harness";

devTest("css file with syntax error does not kill old styles", {
  files: {
    "styles.css": `
      body {
        color: red;
      }
    `,
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `hello world`,
    }),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: red;
          background-color
        }
      `,
      {
        errors: ["styles.css:4:1: error: Unexpected end of input"],
      },
    );
    await c.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: red;
          background-color: blue;
        }
      `,
    );
    await c.style("body").backgroundColor.expect.toBe("#00f");
    await dev.write("styles.css", ` `, { dedent: false });
    await c.style("body").notFound();
  },
});
devTest("css file with initial syntax error gets recovered", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `hello world`,
    }),
    "styles.css": `
      body {
        color: red;
      }}
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["styles.css:3:3: error: Unexpected end of input"],
    });
    // hard reload to dismiss the error overlay
    await c.expectReload(async () => {
      await dev.write(
        "styles.css",
        `
          body {
            color: red;
          }
        `,
      );
    });
    await c.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: blue;
        }
      `,
    );
    await c.style("body").color.expect.toBe("#00f");
    await dev.write(
      "styles.css",
      `
        body {
          color: blue;
        }}
      `,
      {
        errors: ["styles.css:3:3: error: Unexpected end of input"],
      },
    );
  },
});
devTest("add new css import later", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `hello world`,
    }),
    "index.ts": `
      // import "./styles.css";
      export default function () {
        return "hello world";
      }
      import.meta.hot.accept();
    `,
    "styles.css": `
      body {
        color: red;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style("body").notFound();
    await dev.patch("index.ts", { find: "// import", replace: "import" });
    await c.style("body").color.expect.toBe("red");
    await dev.patch("index.ts", { find: "import", replace: "// import" });
    await c.style("body").notFound();
  },
});
devTest("css import another css file", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
    }),
    "styles.css": `
      @import "./second.css";
      body {
        color: red;
      }
    `,
    "second.css": `
      h1 {
        color: blue;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    // Verify initial build
    await c.style("h1").color.expect.toBe("#00f");
    await c.style("body").color.expect.toBe("red");

    // Hot reload
    await dev.write(
      "second.css",
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
devTest("asset referenced in css", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
    }),
    "styles.css": `
      body {
        background-image: url(./bun.png);
      }
    `,
    "bun.png": imageFixtures.bun,
  },
  async test(dev) {
    await using c = await dev.client("/");
    let backgroundImage = await c.style("body").backgroundImage;
    assert(backgroundImage);
    await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
    // The served stylesheet is the chunk with the asset reference resolved and
    // nothing else: CSS never gets a source map, so no debugId trailer either.
    const stylesheetHref = (await (await dev.fetch("/")).text()).match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)![1];
    const stylesheet = await (await dev.fetch(stylesheetHref)).text();
    expect(stylesheet).toContain("background-image:");
    expect(stylesheet).not.toContain("debugId");
    await dev.write("bun.png", imageFixtures.bun2);
    backgroundImage = await c.style("body").backgroundImage;
    assert(backgroundImage);
    await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun2);
  },
});
devTest("syntax error crash", {
  files: {
    "styles.css": `
      body {
        background-image: url
      }
    `,
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `hello world`,
    }),
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);
    // previously: panic(main thread): Asset double unref: 0000000000000000
    await dev.patch("styles.css", { find: "url\n", replace: "url(\n" });
    expect((await dev.fetch("/")).status).toBe(500);
  },
});
devTest("css url resolve error on hot reload is recoverable", {
  files: {
    "styles.css": `
      body {
        color: red;
      }
    `,
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `hello world`,
    }),
  },
  async test(dev) {
    {
      await using c = await dev.client("/");
      await c.style("body").color.expect.toBe("red");
      // A CSS file that parses but fails import resolution must fail the
      // rebuild with an error instead of being treated as a valid CSS chunk.
      // previously: panic: assertion failed: !chunk.content.is_css()
      await dev.write(
        "styles.css",
        `
          body {
            background-image: url(./missing.png);
          }
        `,
        {
          errors: ['styles.css:2:21: error: Could not resolve: "./missing.png"'],
        },
      );
    }
    // The failing route is fetched and recovered without a connected client: a
    // fetch re-bundles the route, and both that and the recovery ship the HTML
    // route as a JS module without the route-reload flag, which trips a
    // client-side debug assert (tracked in https://github.com/oven-sh/bun/issues/31908).
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write(
      "styles.css",
      `
        body {
          color: blue;
        }
      `,
    );
    expect((await dev.fetch("/")).status).toBe(200);
  },
});
devTest("circular css imports handle hot reload", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["a.css"],
      body: `
        <div class="a">hello</div>
        <div class="b">hello</div>
      `,
    }),
    "a.css": `
      @import "./b.css";
      .a { color: red; }
    `,
    "b.css": `
      @import "./a.css";
      .b { color: blue; }
    `,
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.style(".a").color.expect.toBe("red");
    await client.style(".b").color.expect.toBe("#00f");

    // Modify one of the circular dependencies
    await dev.write(
      "a.css",
      `
        @import "./b.css";
        .a { color: green; }
      `,
    );
    await client.style(".a").color.expect.toBe("green");
    await client.style(".b").color.expect.toBe("#00f");
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
    {
      await using c1 = await dev.client("/first");
      await c1.style(".first").color.expect.toBe("red");
    }
    await using c2 = await dev.client("/second");
    await c2.style(".second").color.expect.toBe("#00f");

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

    // Fix the first file and ensure both pages still work afterwards.
    await dev.write(
      "first.css",
      `
        .first { color: yellow; }
      `,
    );
    await c2.style(".second").color.expect.toBe("green");
    {
      await using c1 = await dev.client("/first");
      await c1.style(".first").color.expect.toBe("#ff0");
    }
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
// The incremental graph's stale bitset grows in steps of 512 files.
const modulesPastFirstBitsetStep = Array.from({ length: 520 }, (_, i) => `m${i}`);
devTest("css file imported from css first, then from a second page's script", {
  files: {
    "first.html": emptyHtmlFile({
      styles: ["first.css"],
      scripts: ["first.ts"],
    }),
    "second.html": emptyHtmlFile({
      scripts: ["second.ts"],
    }),
    "first.css": `
      .first { color: red; }
    `,
    "child.css": `
      .child { color: blue; }
    `,
    "first.ts": `
      console.log("first");
      import.meta.hot.accept();
    `,
    "second.ts": `
      import "./child.css";
      console.log("second");
    `,
    ...Object.fromEntries(modulesPastFirstBitsetStep.map(name => [`modules/${name}.ts`, `export default "${name}";`])),
  },
  async test(dev) {
    await using c1 = await dev.client("/first");
    await c1.expectMessage("first");

    // A bundle without css pushes the client graph past 512 files, so the bitset
    // grows at the end of the bundle and the new bits mean "cached".
    await dev.write(
      "first.ts",
      [
        ...modulesPastFirstBitsetStep.map(name => `import "./modules/${name}";`),
        `console.log("first with modules");`,
        `import.meta.hot.accept();`,
      ].join("\n"),
    );
    await c1.expectMessage("first with modules");

    // "child.css" enters the client graph as a css import, so it doesn't have its own stylesheet.
    await dev.write(
      "first.css",
      `
        @import "./child.css";
        .first { color: red; }
      `,
    );
    await c1.style(".child").color.expect.toBe("#00f");

    // The script import must bundle "child.css" as a stylesheet of this page.
    await using c2 = await dev.client("/second");
    await c2.expectMessage("second");
    await c2.style(".child").color.expect.toBe("#00f");
  },
});
devTest("multiple stylesheets importing same dependency", {
  files: {
    "first.html": emptyHtmlFile({
      styles: ["first.css"],
      body: `
        <div class="first">hello</div>
        <div class="shared">hello</div>
      `,
    }),
    "second.html": emptyHtmlFile({
      styles: ["second.css"],
      body: `
        <div class="second">hello</div>
        <div class="shared">hello</div>
      `,
    }),
    "first.css": `
      @import "./shared.css";
      .first { color: red; }
    `,
    "second.css": `
      @import "./shared.css";
      .second { color: blue; }
    `,
    "shared.css": `
      .shared { color: green; }
    `,
  },
  async test(dev) {
    await using c1 = await dev.client("/first");
    await using c2 = await dev.client("/second");
    await c1.style(".first").color.expect.toBe("red");
    await c2.style(".second").color.expect.toBe("#00f");
    await c1.style(".shared").color.expect.toBe("green");
    await c2.style(".shared").color.expect.toBe("green");

    await dev.write(
      "shared.css",
      `
        .shared { color: yellow; }
      `,
    );

    await c1.style(".shared").color.expect.toBe("#ff0");
    await c2.style(".shared").color.expect.toBe("#ff0");
  },
});
devTest("removing and re-adding css import", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
    }),
    "main.css": `
      @import "./colors.css";
      .main { background: white; }
    `,
    "colors.css": `
      .colored { color: blue; }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".colored").color.expect.toBe("#00f");

    // Remove the import
    await dev.write(
      "main.css",
      `
        /* @import "./colors.css"; */
        .main { background: white; }
      `,
    );
    await c.style(".colored").notFound();

    // A change to 'colors.css' should not trigger a rebuild of 'main.css', nor notify any clients.
    await c.expectNoWebSocketActivity(async () => {
      await dev.write(
        "colors.css",
        `
          .colored { color: yellow; }
        `,
      );
      await dev.write(
        "colors.css",
        `
          .colored { color: blue; }
        `,
      );
    });
    await c.style(".colored").notFound();

    // Re-add the import
    await dev.write(
      "main.css",
      `
        @import "./colors.css";
        .main { background: white; }
      `,
    );
    await c.style(".colored").color.expect.toBe("#00f");
    await c.style(".main").backgroundColor.expect.toBe("#fff");
  },
});
devTest("changing html file with link tag works", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
    }),
    "styles.css": `
      .test {
        color: blue;
        font-size: 24px;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".test").color.expect.toBe("#00f");
    await c.style(".test").fontSize.expect.toBe("24px");

    await c.expectReload(async () => {
      await dev.writeNoChanges("index.html");
    });
    await c.style(".test").color.expect.toBe("#00f");
    await c.style(".test").fontSize.expect.toBe("24px");

    await c.hardReload();
    await c.style(".test").color.expect.toBe("#00f");
    await c.style(".test").fontSize.expect.toBe("24px");

    await dev.write(
      "index.html",
      emptyHtmlFile({
        styles: ["other.css"],
      }),
      {
        errors: ['index.html: error: Could not resolve: "other.css". Maybe you need to "bun install"?'],
      },
    );
    await c.expectReload(async () => {
      await dev.write(
        "other.css",
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
        "index.html",
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
        "index.html",
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
devTest("a page recovers after the missing @import of a shared stylesheet is created", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["main.css"], scripts: ["main.ts"] }),
    "about.html": emptyHtmlFile({ styles: ["main.css"], scripts: ["about.ts"] }),
    "main.ts": `console.log("main");`,
    "about.ts": `import "./main.css"; console.log("about");`,
    "main.css": `.main { width: 1px; }`,
  },
  async test(dev) {
    const load = async () => {
      await dev.fetch("/index").text();
      const about = await dev.fetch("/about");
      const links = Array.from((await about.text()).matchAll(/<link[^>]*href="([^"]+)"/g), match => match[1]);
      return { status: about.status, links };
    };
    const loaded = { status: 200, links: [expect.stringMatching(/^\/_bun\/asset\/.*\.css$/)] };
    expect(await load()).toEqual(loaded);
    // The other page has a build error of its own the whole time.
    await dev.write("main.ts", `const = ;`, { errors: null });
    expect(await load()).toEqual(loaded);
    await dev.write("main.css", `@import "./n.css";\n.main { width: 1px; }`, { errors: null });
    expect((await load()).status).toBe(500);
    await dev.write("n.css", `.n { width: 2px; }`, { errors: null });
    expect(await load()).toEqual(loaded);
    await using c = await dev.client("/about");
    await c.expectMessage("about");
    await c.style(".n").width.expect.toBe("2px");
  },
});
devTest("an error in a stylesheet reaches a page through an @import that another page links", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["main.css"] }),
    "about.html": emptyHtmlFile({ styles: ["b.css"] }),
    "main.css": `@import "./b.css";\n.m { width: 1px; }`,
    "b.css": `@import "./c.css";\n.b { width: 1px; }`,
    "c.css": `.c { width: 1px; }`,
  },
  async test(dev) {
    // The status of the page, or the width of ".c" in its stylesheet.
    const loadPage = async (url: string) => {
      const page = await dev.fetch(url);
      const html = await page.text();
      if (page.status !== 200) return page.status;
      const css = await dev.fetch(html.match(/\/_bun\/asset\/\w+\.css/)![0]).text();
      return css.match(/\.c \{[^}]*width: (\w+)/)?.[1];
    };
    const load = async () => [await loadPage("/index"), await loadPage("/about")];
    expect(await load()).toEqual(["1px", "1px"]);
    await dev.write("c.css", `.c { width: 2px; }}}`, { errors: null });
    expect(await load()).toEqual([500, 500]);
    await dev.write("c.css", `.c { width: 3px; }`, { errors: null });
    expect(await load()).toEqual(["3px", "3px"]);
  },
});
// The status of a page, and the class names in each stylesheet that it links.
async function linkedStylesheets(dev: { fetch(url: string): Promise<Response> }, url: string) {
  const page = await dev.fetch(url);
  const html = await page.text();
  const hrefs = Array.from(html.matchAll(/<link[^>]*href="([^"]+)"/g), match => match[1]);
  const sheets = await Promise.all(
    hrefs.map(async href => ((await (await dev.fetch(href)).text()).match(/\.[a-z]+-v\d/g) ?? []).join(" ")),
  );
  return { status: page.status, sheets: sheets.sort() };
}
devTest("css file broken at startup that a page imports and a stylesheet imports gets a stylesheet of its own", {
  files: {
    // Each page reaches its "dep.css" through the @import in "main.css", and directly.
    "link/index.html": emptyHtmlFile({ styles: ["main.css", "dep.css"] }),
    "link/main.css": `@import "./dep.css";\n.main-v1 { color: red; }`,
    "link/dep.css": `.dep-v1 { color: red; }}`,
    "script/index.html": emptyHtmlFile({ styles: ["main.css"], scripts: ["app.ts"] }),
    "script/app.ts": `import "./dep.css";`,
    "script/main.css": `@import "./dep.css";\n.main-v1 { color: red; }`,
    "script/dep.css": `@import "./missing.css";\n.dep-v1 { color: red; }`,
    // This "dep.css" parses. Its failure is the @import of a file that is not css.
    "invalid/index.html": emptyHtmlFile({ styles: ["main.css", "dep.css"] }),
    "invalid/main.css": `@import "./dep.css";\n.main-v1 { color: red; }`,
    "invalid/dep.css": `@import "./module.ts";\n.dep-v1 { color: red; }`,
    "invalid/module.ts": `export {};`,
  },
  async test(dev) {
    const pages = ["/link", "/script", "/invalid"];
    // The second request of a page reads what its failed bundle left behind.
    for (const request of [1, 2]) {
      for (const page of pages) {
        expect({ page, request, ...(await linkedStylesheets(dev, page)) }).toEqual({
          page,
          request,
          status: 500,
          sheets: [],
        });
      }
    }
    for (const version of [2, 3]) {
      for (const page of pages) {
        await dev.write(`${page.slice(1)}/dep.css`, `.dep-v${version} { color: red; }`, { errors: null });
        expect({ page, ...(await linkedStylesheets(dev, page)) }).toEqual({
          page,
          status: 200,
          sheets: [`.dep-v${version}`, `.dep-v${version} .main-v1`],
        });
      }
    }
  },
});
devTest("css file broken at startup comes back in the stylesheet that imports it after its script importer is saved", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["main.css"], scripts: ["app.ts"] }),
    "app.ts": `import "./dep.css";`,
    "main.css": `@import "./dep.css";\n.main-v1 { color: red; }`,
    "dep.css": `@import "./missing.css";\n.dep-v1 { color: red; }`,
  },
  async test(dev) {
    expect(await linkedStylesheets(dev, "/")).toEqual({ status: 500, sheets: [] });
    // This bundle has "dep.css", and does not have "main.css".
    await dev.write("app.ts", `import "./dep.css";\nconsole.log("saved");`, { errors: null });
    // The repair is the file that the @import did not find.
    await dev.write("missing.css", `.missing-v1 { color: red; }`, { errors: null });
    expect(await linkedStylesheets(dev, "/")).toEqual({
      status: 200,
      sheets: [".missing-v1 .dep-v1", ".missing-v1 .dep-v1 .main-v1"],
    });
  },
});
devTest("css file broken at startup comes back for a page that links it and for a page that imports it", {
  files: {
    // "linked.html" links "shared.css". "imported.html" reaches it through the @import in "root.css".
    ...Object.fromEntries(
      ["one", "two"].flatMap(dir => [
        [`${dir}/linked.html`, emptyHtmlFile({ styles: ["shared.css"] })],
        [`${dir}/imported.html`, emptyHtmlFile({ styles: ["root.css"] })],
        [`${dir}/root.css`, `@import "./shared.css";\n.root-v1 { color: red; }`],
        [`${dir}/shared.css`, `.shared-v1 { color: red; }}`],
      ]),
    ),
  },
  async test(dev) {
    // The two pages are first bundled in one order, then in the other.
    for (const page of ["/one/imported", "/one/linked", "/two/linked", "/two/imported"]) {
      expect(await linkedStylesheets(dev, page)).toEqual({ status: 500, sheets: [] });
    }
    for (const dir of ["one", "two"]) {
      await dev.write(`${dir}/shared.css`, `.shared-v2 { color: red; }`, { errors: null });
      expect(await linkedStylesheets(dev, `/${dir}/linked`)).toEqual({ status: 200, sheets: [".shared-v2"] });
      expect(await linkedStylesheets(dev, `/${dir}/imported`)).toEqual({
        status: 200,
        sheets: [".shared-v2 .root-v1"],
      });
    }
  },
});
devTest(
  "css file that lost its direct importer while it did not build is repaired through the stylesheet that imports it",
  {
    // A request for a failed page answers with the recorded failure. It does not bundle the page again.
    env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
    files: {
      ...Object.fromEntries(
        ["link", "script", "kept"].flatMap(dir => [
          [`${dir}/main.css`, `@import "./dep.css";\n.main-v1 { color: red; }`],
          [`${dir}/dep.css`, `@import "./sub/x.css";\n.dep-v1 { color: red; }`],
        ]),
      ),
      "link/index.html": emptyHtmlFile({ styles: ["main.css", "dep.css"] }),
      "script/index.html": emptyHtmlFile({ styles: ["main.css"], scripts: ["app.ts"] }),
      "script/app.ts": `import "./dep.css";`,
      "kept/index.html": emptyHtmlFile({ styles: ["main.css", "dep.css"] }),
    },
    async test(dev) {
      const dirs = ["link", "script", "kept"];
      for (const dir of dirs) {
        expect(await linkedStylesheets(dev, `/${dir}`)).toEqual({ status: 500, sheets: [] });
      }
      // Two pages stop importing "dep.css" directly. "main.css" still imports it.
      await dev.write("link/index.html", emptyHtmlFile({ styles: ["main.css"] }), { errors: null });
      await dev.write("script/app.ts", `console.log("no import");`, { errors: null });
      for (const dir of dirs) {
        // No watcher event reaches "dep.css": the directory of its @import did not exist.
        dev.mkdir(`${dir}/sub`);
        await Bun.write(dev.join(`${dir}/sub/x.css`), `.x-v1 { color: red; }`);
        await dev.write(`${dir}/main.css`, `@import "./dep.css";\n.main-v2 { color: red; }`, { errors: null });
      }
      for (const dir of ["link", "script"]) {
        expect({ dir, ...(await linkedStylesheets(dev, `/${dir}`)) }).toEqual({
          dir,
          status: 200,
          sheets: [".x-v1 .dep-v1 .main-v2"],
        });
      }
      // "kept/index.html" still links "dep.css", so that stylesheet needs a bundle of its own.
      await dev.write("kept/dep.css", `@import "./sub/x.css";\n.dep-v2 { color: red; }`, { errors: null });
      expect(await linkedStylesheets(dev, "/kept")).toEqual({
        status: 200,
        sheets: [".x-v1 .dep-v2", ".x-v1 .dep-v2 .main-v2"],
      });
    },
  },
);
devTest("css file linked as ./styles.css comes back after a failed save when a tailwind plugin is configured", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./tailwind-plugin.ts"]
    `,
    // With "tailwind" in the path of a plugin and in a stylesheet, every bundle has that stylesheet as an entry point.
    "tailwind-plugin.ts": `export default { name: "tailwind-plugin", setup() {} };`,
    "index.html": emptyHtmlFile({ styles: ["./styles.css"] }),
    "styles.css": `.tailwind-v1 { color: red; }`,
  },
  async test(dev) {
    expect(await linkedStylesheets(dev, "/")).toEqual({ status: 200, sheets: [".tailwind-v1"] });
    // The page is bundled again while the stylesheet is broken: first by a request, then by a save.
    await dev.write("styles.css", `.tailwind-v2 { color: red; }}`, { errors: null });
    expect(await linkedStylesheets(dev, "/")).toEqual({ status: 500, sheets: [] });
    await dev.write("styles.css", `.tailwind-v3 { color: red; }`, { errors: null });
    expect(await linkedStylesheets(dev, "/")).toEqual({ status: 200, sheets: [".tailwind-v3"] });

    await dev.write("styles.css", `.tailwind-v4 { color: red; }}`, { errors: null });
    await dev.write("index.html", emptyHtmlFile({ styles: ["./styles.css"], body: "saved" }), { errors: null });
    await dev.write("styles.css", `.tailwind-v5 { color: red; }`, { errors: null });
    expect(await linkedStylesheets(dev, "/")).toEqual({ status: 200, sheets: [".tailwind-v5"] });
  },
});
devTest(
  "css file broken at startup whose import an onResolve plugin answers or declines fails its page until it is repaired",
  {
    files: {
      "bunfig.toml": `
      [serve.static]
      plugins = ["./resolve-plugin.ts"]
    `,
      "resolve-plugin.ts": `
      import { join } from "node:path";
      export default {
        name: "resolve-plugin",
        setup(build) {
          build.onResolve({ filter: /^aliased-styles$/ }, args => ({ path: join(args.importer, "..", "styles.css") }));
          build.onResolve({ filter: /declined\\.css$/ }, () => undefined);
        },
      };
    `,
      "answered/index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
      "answered/app.ts": `import "aliased-styles";`,
      "answered/styles.css": `.styles-v1 { color: red; }}`,
      "declined/index.html": emptyHtmlFile({ styles: ["declined.css"] }),
      "declined/declined.css": `.styles-v1 { color: red; }}`,
    },
    async test(dev) {
      for (const [page, file] of [
        ["/answered", "answered/styles.css"],
        ["/declined", "declined/declined.css"],
      ]) {
        for (const request of [1, 2]) {
          expect({ page, request, ...(await linkedStylesheets(dev, page)) }).toEqual({
            page,
            request,
            status: 500,
            sheets: [],
          });
        }
        await dev.write(file, `.styles-v2 { color: red; }`, { errors: null });
        expect({ page, ...(await linkedStylesheets(dev, page)) }).toEqual({
          page,
          status: 200,
          sheets: [".styles-v2"],
        });
      }
    },
  },
);
devTest("css file in a plugin namespace that does not build fails its page until it is repaired", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./virtual-css-plugin.ts"]
    `,
    // bun-plugin-svelte answers the specifier as the path, like "virtual:same.css" here.
    "virtual-css-plugin.ts": `
      import { join } from "node:path";
      export default {
        name: "virtual-css-plugin",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => ({
            path: args.path === "virtual:same.css" ? args.path : "other.css",
            namespace: "virtual",
          }));
          build.onLoad({ filter: /\\.css$/, namespace: "virtual" }, async args => ({
            contents: await Bun.file(join(import.meta.dir, args.path.replace(/^virtual:|\\.css$/g, ""), "styles.txt")).text(),
            loader: "css",
          }));
        },
      };
    `,
    "same/index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "same/app.ts": `import "virtual:same.css";`,
    "same/styles.txt": `.styles-v1 { color: red; }}`,
    "other/index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "other/app.ts": `import "virtual:other.css";`,
    "other/styles.txt": `@import "./missing.css";\n.styles-v1 { color: red; }`,
  },
  async test(dev) {
    for (const name of ["same", "other"]) {
      for (const request of [1, 2, 3]) {
        expect({ name, request, ...(await linkedStylesheets(dev, `/${name}`)) }).toEqual({
          name,
          request,
          status: 500,
          sheets: [],
        });
      }
      // The plugin reads "styles.txt" again when the script that imports the stylesheet is bundled.
      await Bun.write(dev.join(`${name}/styles.txt`), `.styles-v2 { color: red; }`);
      await dev.write(`${name}/app.ts`, `import "virtual:${name}.css";\nconsole.log("saved");`, { errors: null });
      expect({ name, ...(await linkedStylesheets(dev, `/${name}`)) }).toEqual({
        name,
        status: 200,
        sheets: [".styles-v2"],
      });
    }
  },
});
devTest("css file that a framework route imports stays a css root when it does not build", {
  framework: minimalFramework,
  files: {
    // The server graph holds the importer of these two stylesheets.
    "routes/index.ts": `
      import "../dep.css";
      import "../main.css";
      export default (req, meta) => Response.json(meta.styles);
    `,
    "main.css": `@import "./dep.css";\n.main-v1 { color: red; }`,
    "dep.css": `.dep-v1 { color: red; }}`,
  },
  async test(dev) {
    const routeStylesheets = async () => {
      const hrefs: string[] = await dev.fetch("/").json();
      const sheets = await Promise.all(
        hrefs.map(async href => ((await dev.fetch(href).text()).match(/\.[a-z]+-v\d/g) ?? []).join(" ")),
      );
      return sheets.sort();
    };
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("dep.css", `.dep-v2 { color: red; }`, { errors: null });
    expect(await routeStylesheets()).toEqual([".dep-v2", ".dep-v2 .main-v1"]);
    // The next failure finds "dep.css" as a stylesheet of its own and as an @import of "main.css".
    await dev.write("dep.css", `.dep-v3 { color: red; }}`, { errors: null });
    await dev.write("dep.css", `.dep-v4 { color: red; }`, { errors: null });
    expect(await routeStylesheets()).toEqual([".dep-v4", ".dep-v4 .main-v1"]);
  },
});
devTest("script that does not build is not a stylesheet of a page that reaches it through a module", {
  files: {
    "first.html": emptyHtmlFile({ scripts: ["broken.ts", "module.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["module.ts"] }),
    "module.ts": `import "./broken.ts";`,
    "broken.ts": `console.log("v1");`,
  },
  async test(dev) {
    expect(await linkedStylesheets(dev, "/first")).toEqual({ status: 200, sheets: [] });
    await dev.write("broken.ts", `console.log("v2"`, { errors: null });
    // This request bundles "first.html" together with the script that does not build.
    expect((await linkedStylesheets(dev, "/first")).status).toBe(500);
    expect((await linkedStylesheets(dev, "/second")).sheets).toEqual([]);
  },
});
devTest("css file with an @import of a file that is not css is a build error until it is repaired", {
  files: {
    "saved/index.html": emptyHtmlFile({ styles: ["styles.css"] }),
    "saved/styles.css": `.styles-v1 { color: red; }`,
    "saved/module.ts": `export {};`,
    // The bundler finds "module.ts" through "styles.css", so it reads the script after the stylesheet that it imports.
    "cycle/index.html": emptyHtmlFile({ styles: ["styles.css"] }),
    "cycle/styles.css": `@import "./module.ts";\n.styles-v1 { color: red; }`,
    "cycle/module.ts": `import "./styles.css";`,
  },
  async test(dev) {
    expect(await linkedStylesheets(dev, "/saved")).toEqual({ status: 200, sheets: [".styles-v1"] });
    for (const version of [2, 3]) {
      await dev.write("saved/styles.css", `@import "./module.ts";\n.styles-v${version} { color: red; }`, {
        errors: null,
      });
      expect(await linkedStylesheets(dev, "/saved")).toEqual({ status: 500, sheets: [] });
    }
    await dev.write("saved/styles.css", `.styles-v4 { color: red; }`, { errors: null });
    expect(await linkedStylesheets(dev, "/saved")).toEqual({ status: 200, sheets: [".styles-v4"] });

    for (const request of [1, 2]) {
      expect({ request, ...(await linkedStylesheets(dev, "/cycle")) }).toEqual({ request, status: 500, sheets: [] });
    }
    await dev.write("cycle/styles.css", `.styles-v2 { color: red; }`, { errors: null });
    expect(await linkedStylesheets(dev, "/cycle")).toEqual({ status: 200, sheets: [".styles-v2"] });
  },
});
devTest("an open page gets the styles of a css file that did not build when its script first imported it", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      scripts: ["index.ts"],
      body: `<h1>hello</h1><h2>world</h2>`,
    }),
    "index.ts": `
      import.meta.hot.accept();
    `,
    "styles.css": `
      @import "./second.css";
      body {
        color: red;
      }
    `,
    "second.css": `
      h2 {
        color: blue;
      }
    `,
    "third.css": `
      h1 {
        color: blue;
      }}
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style("h2").color.expect.toBe("#00f");

    // The script gains an import of a stylesheet that has never built.
    await dev.write(
      "index.ts",
      `
        import "./third.css";
        import.meta.hot.accept();
      `,
      {
        errors: ["third.css:3:3: error: Unexpected end of input"],
      },
    );
    await dev.write(
      "third.css",
      `
        h1 {
          color: green;
        }
      `,
    );
    await c.style("h1").color.expect.toBe("green");

    // One bundle breaks a stylesheet that "styles.css" imports, and makes the script import it too.
    {
      await using batch = await dev.batchChanges({
        errors: ["second.css:3:3: error: Unexpected end of input"],
      });
      await dev.write(
        "second.css",
        `
          h2 {
            color: green;
          }}
        `,
      );
      await dev.write(
        "index.ts",
        `
          import "./third.css";
          import "./second.css";
          import.meta.hot.accept();
        `,
      );
    }
    await dev.write(
      "second.css",
      `
        h2 {
          color: green;
        }
      `,
    );
    await c.style("h2").color.expect.toBe("green");
    await c.style("h1").color.expect.toBe("green");
    await c.style("body").color.expect.toBe("red");
    // "styles.css", "second.css" and "third.css" each have a link on a new page.
    expect((await linkedStylesheets(dev, "/")).sheets).toHaveLength(3);
  },
});
devTest("css file that an onLoad plugin turns into javascript is bundled as a module without a stylesheet link", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-as-js-plugin.ts"]
    `,
    "css-as-js-plugin.ts": `
      export default {
        name: "css-as-js-plugin",
        setup(build) {
          build.onLoad({ filter: /dep\\.css$/ }, async ({ path }) => {
            const text = await Bun.file(path).text();
            if (text.includes("as javascript")) return { contents: "globalThis.dep = 1;", loader: "js" };
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "app.ts": `import "./dep.css";`,
    "dep.css": `.dep-v1 { color: red; }`,
  },
  async test(dev) {
    expect(await linkedStylesheets(dev, "/")).toEqual({ status: 200, sheets: [".dep-v1"] });
    await dev.write("dep.css", `/* as javascript */`, { errors: null });
    expect(await linkedStylesheets(dev, "/")).toEqual({ status: 200, sheets: [] });
    const script = (await dev.fetch("/").text()).match(/<script[^>]*src="([^"]+)"/)![1];
    expect(await dev.fetch(script).text()).toContain("globalThis.dep = 1;");
  },
});
devTest("css import before create", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: `
        <div>HELLO</div>
      `,
    }),
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ['index.html: error: Could not resolve: "styles.css". Maybe you need to "bun install"?'],
    });
    await dev.fetch("/").expect.not.toContain("HELLO");
    await dev.write(
      "styles.css",
      `
        body {
          background-image: url(bun.png);
        }
      `,
      {
        errors: ['styles.css:2:21: error: Could not resolve: "bun.png". Maybe you need to "bun install"?'],
      },
    );
    await c.expectReload(async () => {
      await dev.write("bun.png", imageFixtures.bun);
    });
    const backgroundImage = await c.style("body").backgroundImage;
    assert(backgroundImage);
    await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
    await dev.fetch("/").expect.toContain("HELLO");
  },
});
devTest("css import before create project relative", {
  files: {
    "html/index.html": emptyHtmlFile({
      styles: ["/style/styles.css"],
      body: `
        <div>HELLO</div>
      `,
    }),
  },
  async test(dev) {
    dev.mkdir("style"); // (See DevServer.zig "BUN-10968")
    await using c = await dev.client("/", {
      errors: ['html/index.html: error: Could not resolve: "/style/styles.css"'],
    });
    await dev.fetch("/").expect.not.toContain("HELLO");
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
    await c.expectNoWebSocketActivity(async () => {
      await dev.write("assets/bun.png", imageFixtures.bun, { errors: null });
      await dev.delete("assets/bun.png", { errors: null });
    });
    await dev.fetch("/").expect.not.toContain("HELLO");
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
    await dev.fetch("/").expect.toContain("HELLO");
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
