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
// When an onResolve plugin declines an import, the bundler resolves it and the import
// record keeps the specifier as its path. The dev server must not take that for the file's path.
devTest("editing a stylesheet whose @import an onResolve plugin declined", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-plugin.ts"]
    `,
    "css-plugin.ts": `
      export default {
        name: "css-plugin",
        setup(build) {
          build.onResolve({ filter: /child\\.css$/ }, () => undefined);
        },
      };
    `,
    "index.html": emptyHtmlFile({ styles: ["main.css"] }),
    "main.css": `
      @import "./child.css";
      .main { color: red; }
    `,
    "child.css": `
      .child { color: blue; }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".child").color.expect.toBe("#00f");
    await dev.write(
      "child.css",
      `
        .child { color: green; }
      `,
    );
    await c.style(".child").color.expect.toBe("green");
  },
});
// A file is one module for each loader it is used with: the stylesheet "x.css" and
// `"x.css" with { type: "text" }` are two modules. A script that reads an import
// logs the error if the read throws.
devTest("a stylesheet that a script imports as text", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["x.css"], scripts: ["app.ts"] }),
    "x.css": `.box { color: red; }`,
    "app.ts": `
      import text from "./x.css" with { type: "text" };
      const load = 1;
      let value;
      try {
        value = text;
      } catch (e) {
        value = "throws " + e.name;
      }
      console.log("load " + load + ": " + value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("load 1: .box { color: red; }");
    await c.style(".box").color.expect.toBe("red");

    // Only the importer is bundled again. It finds the text module in the dev server's cache.
    await c.expectReload(async () => {
      await dev.patch("app.ts", { find: "load = 1", replace: "load = 2" });
    });
    await c.expectMessage("load 2: .box { color: red; }");
    await c.style(".box").color.expect.toBe("red");

    // Both modules of the file are bundled again.
    await c.expectReload(async () => {
      await dev.write("x.css", `.box { color: blue; }`);
    });
    await c.expectMessage("load 2: .box { color: blue; }");
    await c.style(".box").color.expect.toBe("#00f");

    await using c2 = await dev.client("/");
    await c2.expectMessage("load 2: .box { color: blue; }");
    await c2.style(".box").color.expect.toBe("#00f");
  },
});
devTest("a file that is imported as text becomes a stylesheet when a module imports it", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "x.css": `.box { color: red; }`,
    "other.ts": `export const other = "no stylesheet";`,
    "app.ts": `
      import text from "./x.css" with { type: "text" };
      import { other } from "./other.ts";
      let value;
      try {
        value = text;
      } catch (e) {
        value = "throws " + e.name;
      }
      console.log(other + ": " + value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("no stylesheet: .box { color: red; }");
    await c.style(".box").notFound();

    await c.expectReload(async () => {
      await dev.write("other.ts", `import "./x.css";\nexport const other = "stylesheet";`);
    });
    await c.expectMessage("stylesheet: .box { color: red; }");
    await c.style(".box").color.expect.toBe("red");

    await c.expectReload(async () => {
      await dev.write("other.ts", `export const other = "no stylesheet again";`);
    });
    await c.expectMessage("no stylesheet again: .box { color: red; }");
    await c.style(".box").notFound();
  },
});
devTest("a stylesheet that a script imports as a file", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["x.css"], scripts: ["app.ts"] }),
    "x.css": `.box { color: red; }`,
    "app.ts": `
      import url from "./x.css" with { type: "file" };
      let value;
      try {
        value = typeof url + " " + url;
      } catch (e) {
        value = "throws " + e.name;
      }
      console.log(value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    const message = await c.getStringMessage();
    expect(message).toMatch(/^string \/_bun\/asset\/[0-9a-f]{16}\.css$/);
    // The url serves the file as it is on disk. The page's stylesheet is the bundled css.
    expect(await dev.fetch(message.slice("string ".length)).text()).toBe(".box { color: red; }");
    await c.style(".box").color.expect.toBe("red");
  },
});
devTest("one script imports a stylesheet and another script imports it as text", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["a.ts", "b.ts"] }),
    "x.css": `.box { color: red; }`,
    "a.ts": `
      import "./x.css";
      console.log("a");
    `,
    "b.ts": `
      import text from "./x.css" with { type: "text" };
      let value;
      try {
        value = text;
      } catch (e) {
        value = "throws " + e.name;
      }
      console.log("b: " + value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("a", "b: .box { color: red; }");
    await c.style(".box").color.expect.toBe("red");
  },
});
// The dev server merges the import statements of one specifier. A statement with another
// `with { type }` imports another module, so it stays a statement of its own.
for (const first of ["stylesheet", "text"]) {
  const stylesheetImport = `import "./x.css";`;
  const textImport = `import text from "./x.css" with { type: "text" };`;
  devTest(`one module imports a stylesheet and its text, with the ${first} import first`, {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
      "x.css": `.box { color: red; }`,
      "app.ts": `
        ${first === "stylesheet" ? stylesheetImport : textImport}
        ${first === "stylesheet" ? textImport : stylesheetImport}
        const load = 1;
        let value;
        try {
          value = text;
        } catch (e) {
          value = "throws " + e.name;
        }
        console.log("load " + load + ": " + value);
      `,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("load 1: .box { color: red; }");
      await c.style(".box").color.expect.toBe("red");

      // Only the importer is bundled again. It finds both modules of the file in the dev server's cache.
      await c.expectReload(async () => {
        await dev.patch("app.ts", { find: "load = 1", replace: "load = 2" });
      });
      await c.expectMessage("load 2: .box { color: red; }");
      await c.style(".box").color.expect.toBe("red");

      // Both modules of the file are bundled again.
      await c.expectReload(async () => {
        await dev.write("x.css", `.box { color: blue; }`);
      });
      await c.expectMessage("load 2: .box { color: blue; }");
      await c.style(".box").color.expect.toBe("#00f");
    },
  });
}
// The dev server retires the stylesheet of a file when no module imports the file as a stylesheet
// any more and a module imports it with another type. See "retires the module" in bundle.test.ts.
devTest("the error of a stylesheet leaves the overlay when its import gets a type", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "x.css": `.box { color: red; }}`,
    "app.ts": `
      import "./x.css";
      console.log("stylesheet");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { errors: ["x.css:1:22: error: Unexpected end of input"] });

    await c.expectReload(async () => {
      await dev.write(
        "app.ts",
        `
          import text from "./x.css" with { type: "text" };
          let value;
          try {
            value = text;
          } catch (e) {
            value = "throws " + e.name;
          }
          console.log("text: " + value);
        `,
      );
    });
    await c.expectMessage("text: .box { color: red; }}");
    await c.style(".box").notFound();
  },
});
// The observer page imports nothing of the stylesheet. It never reloads, so a build error stays in its overlay.
const observerPage = {
  "observer.html": emptyHtmlFile({ scripts: ["observer.ts"] }),
  "observer.ts": `console.log("observer");`,
};
devTest("a save does not bundle the retired stylesheet of a file that a second script imports as text", {
  files: {
    ...observerPage,
    "index.html": emptyHtmlFile({ scripts: ["a.ts", "b.ts"] }),
    "x.css": `.box { color: red; }`,
    "a.ts": `
      import "./x.css";
      console.log("a: stylesheet");
    `,
    "b.ts": `
      import text from "./x.css" with { type: "text" };
      let value;
      try {
        value = text;
      } catch (e) {
        value = "throws " + e.name;
      }
      console.log("b: " + value);
    `,
  },
  async test(dev) {
    await using observer = await dev.client("/observer");
    await observer.expectMessage("observer");
    await using c = await dev.client("/index");
    await c.expectMessage("a: stylesheet", "b: .box { color: red; }");
    await c.style(".box").color.expect.toBe("red");

    await c.expectReload(async () => {
      await dev.write("a.ts", `console.log("a: no stylesheet");`);
    });
    await c.expectMessage("a: no stylesheet", "b: .box { color: red; }");
    await c.style(".box").notFound();

    // A css parser rejects this content. The save bundles the text module only, so there is no error.
    await c.expectReload(async () => {
      await dev.write("x.css", `.box { color: blue; }}`);
    });
    await c.expectMessage("a: no stylesheet", "b: .box { color: blue; }}");
    await c.style(".box").notFound();
    await c.expectReload(async () => {
      await dev.write("x.css", `.box { color: green; }`);
    });
    await c.expectMessage("a: no stylesheet", "b: .box { color: green; }");

    // The stylesheet comes back from the file as it is now.
    await c.expectReload(async () => {
      await dev.write("a.ts", `import "./x.css";\nconsole.log("a: stylesheet again");`);
    });
    await c.expectMessage("a: stylesheet again", "b: .box { color: green; }");
    await c.style(".box").color.expect.toBe("green");
  },
});
// An `@import` adds an importer to the stylesheet of a file without a bundle of that stylesheet on its own.
devTest("a retired stylesheet that a second stylesheet starts to @import follows each save", {
  files: {
    "index.html": emptyHtmlFile({ styles: ["main.css"], scripts: ["app.ts"] }),
    "main.css": `.main { color: green; }`,
    "x.css": `.box { color: red; }`,
    "app.ts": `
      import "./x.css";
      console.log("stylesheet");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("stylesheet");
    await c.style(".box").color.expect.toBe("red");

    await c.expectReload(async () => {
      await dev.write(
        "app.ts",
        `
          import text from "./x.css" with { type: "text" };
          let value;
          try {
            value = text;
          } catch (e) {
            value = "throws " + e.name;
          }
          console.log("text: " + value);
        `,
      );
    });
    await c.expectMessage("text: .box { color: red; }");
    await c.style(".box").notFound();

    await dev.write("main.css", `@import "./x.css";\n.main { color: green; }`);
    await c.style(".box").color.expect.toBe("red");

    await c.expectReload(async () => {
      await dev.write("x.css", `.box { color: blue; }`);
    });
    await c.expectMessage("text: .box { color: blue; }");
    await c.style(".box").color.expect.toBe("#00f");
  },
});
// The route gets the stylesheet through the server module that imports it, not through a browser module.
devTest("a stylesheet that a route imports stays in the bundle when a client component imports it as text", {
  framework: minimalFramework,
  files: {
    "x.css": `.box { color: red; }`,
    "Widget.ts": `
      "use client";
      import "./x.css";
      export const widget = "stylesheet";
    `,
    "routes/index.ts": `
      import "../x.css";
      import "../Widget.ts";
      export default function (req, meta) {
        return Response.json(meta.styles);
      }
    `,
  },
  async test(dev) {
    const styles: string[] = await dev.fetch("/").json();
    expect(styles).toHaveLength(1);
    await dev.fetch(styles[0]).equals("/* x.css */\n.box {\n  color: red;\n}");

    // No browser module imports "x.css" as a stylesheet now.
    await dev.write(
      "Widget.ts",
      `
        "use client";
        import text from "./x.css" with { type: "text" };
        export const widget = text;
      `,
    );
    await dev.fetch("/").equals(styles);

    await dev.write("x.css", `.box { color: blue; }`);
    await dev.fetch("/").equals(styles);
    await dev.fetch(styles[0]).equals("/* x.css */\n.box {\n  color: #00f;\n}");
  },
});
devTest("a retired stylesheet follows each save again when a route that imports it is bundled", {
  framework: minimalFramework,
  files: {
    "x.css": `.box { color: red; }`,
    "Widget.ts": `
      "use client";
      import "./x.css";
      export const widget = "stylesheet";
    `,
    "routes/index.ts": `
      import "../Widget.ts";
      export default function (req, meta) {
        return Response.json(meta.styles);
      }
    `,
    "routes/other.ts": `
      import "../x.css";
      export default function (req, meta) {
        return Response.json(meta.styles);
      }
    `,
  },
  async test(dev) {
    const styles: string[] = await dev.fetch("/").json();
    expect(styles).toHaveLength(1);

    // Only the client component imports "x.css" as a stylesheet: the dev server has not bundled "routes/other.ts" yet.
    await dev.write(
      "Widget.ts",
      `
        "use client";
        import text from "./x.css" with { type: "text" };
        export const widget = text;
      `,
    );
    await dev.fetch("/").equals([]);

    await dev.fetch("/other").equals(styles);
    await dev.write("x.css", `.box { color: blue; }`);
    await dev.fetch(styles[0]).equals("/* x.css */\n.box {\n  color: #00f;\n}");
  },
});
// A client component is also bundled for the server graph, so both graphs have its stylesheet.
devTest("the stylesheet of a client component is retired when the component imports it as text", {
  framework: minimalFramework,
  pluginFile: `
    export default [
      {
        name: "count-css-loads",
        setup(build) {
          build.onLoad({ filter: /x\\.css$/ }, args => {
            const loads = (globalThis.cssLoads ??= { server: 0, client: 0 });
            loads[args.side]++;
          });
        },
      },
    ];
  `,
  files: {
    "x.css": `.box { color: red; }`,
    "Widget.ts": `
      "use client";
      import "./x.css";
      export const widget = "stylesheet";
    `,
    "routes/index.ts": `
      import "../Widget.ts";
      export default function (req, meta) {
        return Response.json({ styles: meta.styles.length, loads: globalThis.cssLoads });
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({ styles: 1, loads: { server: 1, client: 1 } });

    await dev.write(
      "Widget.ts",
      `
        "use client";
        import text from "./x.css" with { type: "text" };
        export const widget = text;
      `,
    );
    await dev.fetch("/").equals({ styles: 0, loads: { server: 2, client: 2 } });

    // The save bundles the text module of each graph, and no stylesheet.
    await dev.write("x.css", `.box { color: blue; }`);
    await dev.fetch("/").equals({ styles: 0, loads: { server: 3, client: 3 } });
  },
});
// A server module takes a stylesheet from the dev server's cache if the stylesheet is not stale in
// the server graph. Only a file past the first step of the stale bitset starts that way.
devTest("a server module that starts to import a retired stylesheet bundles it again", {
  framework: {
    fileSystemRouterTypes: [
      { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", clientEntryPoint: "./client.ts" },
    ],
  },
  files: {
    ...Object.fromEntries(modulesPastFirstBitsetStep.map(name => [`modules/${name}.ts`, `export default "${name}";`])),
    "server.ts": [
      ...modulesPastFirstBitsetStep.map(name => `import "./modules/${name}";`),
      `import "./x.css";`,
      `export function render(req, meta) {`,
      `  return Response.json(meta.styles);`,
      `}`,
    ].join("\n"),
    "client.ts": `
      import "./x.css";
      console.log("client entry");
    `,
    "x.css": `.box { color: red; }`,
    "routes/index.ts": `export default function () {}`,
  },
  async test(dev) {
    const styles: string[] = await dev.fetch("/").json();
    expect(styles).toHaveLength(1);

    // First no server module imports "x.css" as a stylesheet, then no browser module does.
    await dev.patch("server.ts", { find: `import "./x.css";`, replace: `` });
    await dev.write(
      "client.ts",
      `
        import text from "./x.css" with { type: "text" };
        console.log("client entry " + text);
      `,
    );

    await dev.patch("server.ts", {
      find: `export function render`,
      replace: `import "./x.css";\nexport function render`,
    });
    await dev.write("x.css", `.box { color: blue; }`);
    await dev.fetch(styles[0]).equals("/* x.css */\n.box {\n  color: #00f;\n}");
  },
});
// With a plugin that has "tailwind" in its name, each hot update also bundles every stylesheet
// whose css has the word "tailwind". A retired stylesheet is not one of them.
devTest("a hot update does not bundle a retired stylesheet that looks like a Tailwind file", {
  files: {
    ...observerPage,
    "bunfig.toml": `
      [serve.static]
      plugins = ["./tailwind-plugin.ts"]
    `,
    "tailwind-plugin.ts": `
      export default {
        name: "tailwind-plugin",
        setup() {},
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "styles.css": `.tailwind { color: red; }`,
    "app.ts": `
      import "./styles.css";
      console.log("stylesheet");
    `,
  },
  async test(dev) {
    await using observer = await dev.client("/observer");
    await observer.expectMessage("observer");
    await using c = await dev.client("/index");
    await c.expectMessage("stylesheet");
    await c.style(".tailwind").color.expect.toBe("red");

    await c.expectReload(async () => {
      await dev.write(
        "app.ts",
        `
          import text from "./styles.css" with { type: "text" };
          let value;
          try {
            value = text;
          } catch (e) {
            value = "throws " + e.name;
          }
          console.log("text: " + value);
        `,
      );
    });
    await c.expectMessage("text: .tailwind { color: red; }");

    // A css parser rejects this content. The save bundles the text module only, so there is no error.
    await c.expectReload(async () => {
      await dev.write("styles.css", `.tailwind { color: blue; }}`);
    });
    await c.expectMessage("text: .tailwind { color: blue; }}");
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
