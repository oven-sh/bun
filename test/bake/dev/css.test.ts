// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";
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
// https://github.com/oven-sh/bun/issues/18258
devTest("css module exports its class names to the importer", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<h1>Hello</h1>`,
    }),
    "styles.module.css": `
      .title {
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      document.querySelector("h1").className = styles.title;
      globalThis.evalCount = (globalThis.evalCount ?? 0) + 1;
      globalThis.classKeys = Object.keys(styles).sort().join(",");
      console.log("class:" + styles.title);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    const msg = await c.getStringMessage();
    assert(msg.startsWith("class:title_"), `expected a scoped class name, got ${JSON.stringify(msg)}`);
    const className = msg.slice("class:".length);
    await c.style("." + className).color.expect.toBe("red");

    // The scoped name only depends on the file path, so a style edit keeps the
    // class map. It must arrive as a CSS-only update: no reload, no re-evaluation.
    await dev.patch("styles.module.css", { find: "red", replace: "blue" });
    await c.style("." + className).color.expect.toBe("#00f");
    expect(await c.js<[string, number]>`[document.querySelector("h1").className, globalThis.evalCount]`).toEqual([
      className,
      1,
    ]);

    // A new class changes the class map. The importer does not accept hot
    // updates, so the page reloads and evaluates against the new map.
    await c.expectReload(async () => {
      await dev.write(
        "styles.module.css",
        `
          .extra { font-weight: 700; }
          .title { color: blue; }
        `,
      );
    });
    await c.expectMessage("class:" + className);
    await c.style("." + className).color.expect.toBe("#00f");
    expect(await c.js<string>`globalThis.classKeys`).toBe("extra,title");
  },
});
devTest("css module import shapes", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "shapes.module.css": `
      .a { color: red; }
      .b-c { color: blue; }
    `,
    "empty.module.css": `/* no local names */`,
    "plain.css": `
      body { background-color: green; }
    `,
    "index.ts": `
      import styles, { a } from "./shapes.module.css";
      import * as ns from "./shapes.module.css";
      import empty from "./empty.module.css";
      import "./plain.css";
      const dyn = await import("./shapes.module.css");
      const req = require("./shapes.module.css");
      console.log(JSON.stringify({
        named: a === styles.a,
        ns: ns.default === styles && ns.a === a,
        dyn: dyn.default === styles && dyn.a === a,
        req: req === styles,
        keys: Object.keys(styles).sort(),
        scoped: styles.a.startsWith("a_") && styles["b-c"].startsWith("b-c_"),
        empty,
      }));
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(
      JSON.stringify({ named: true, ns: true, dyn: true, req: true, keys: ["a", "b-c"], scoped: true, empty: {} }),
    );
    await c.style("body").backgroundColor.expect.toBe("green");
  },
});
devTest("css module class list edits reach an accepting importer", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "styles.module.css": `
      .a { color: red; }
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      console.log("keys:" + Object.keys(styles).sort().join(","));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("keys:a");
    await dev.write(
      "styles.module.css",
      `
        .a { color: red; }
        .b { color: blue; }
      `,
    );
    await c.expectMessage("keys:a,b");
    await dev.write("styles.module.css", ` `, { dedent: false });
    await c.expectMessage("keys:");
    await dev.write("styles.module.css", `.b { color: blue; }`);
    await c.expectMessage("keys:b");
  },
});
devTest("css module binding survives an edit of the importer", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "styles.module.css": `
      .a { color: red; }
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      console.log("v1:" + Object.keys(styles).join(","));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("v1:a");
    // The css module is cached in the incremental graph and is not parsed
    // again here. The importer must still list it as a dependency.
    await dev.patch("index.ts", { find: "v1", replace: "v2" });
    await c.expectMessage("v2:a");
    await dev.patch("index.ts", { find: "v2", replace: "v3" });
    await c.expectMessage("v3:a");
    await dev.patch("styles.module.css", { find: "red", replace: "blue" });
    await dev.write(
      "styles.module.css",
      `
        .a { color: red; }
        .b { color: blue; }
      `,
    );
    await c.expectMessage("v3:a,b");
  },
});
devTest("css module composes from another file", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<button>ok</button>`,
    }),
    "base.module.css": `
      .base { font-weight: 700; }
    `,
    "button.module.css": `
      .btn {
        composes: base from "./base.module.css";
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./button.module.css";
      document.querySelector("button").className = styles.btn;
      console.log("btn:" + styles.btn);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    const msg = await c.getStringMessage();
    const classes = msg.slice("btn:".length).split(" ").sort();
    expect(classes).toEqual([expect.stringMatching(/^base_/), expect.stringMatching(/^btn_/)]);
    await c.style("." + classes[1]).color.expect.toBe("red");
    await c.style("." + classes[0]).fontWeight.expect.toBe("700");
  },
});
devTest("css module that was only composed from gets imported directly", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "base.module.css": `
      .base { font-weight: 700; }
    `,
    "button.module.css": `
      .btn { color: red; }
    `,
    "index.ts": `
      import styles from "./button.module.css";
      console.log("btn:" + styles.btn.split(" ").length);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("btn:1");
    // base.module.css enters the graph as a child of button.module.css only.
    await dev.write(
      "button.module.css",
      `
        .btn {
          composes: base from "./base.module.css";
          color: red;
        }
      `,
    );
    await c.expectMessage("btn:2");
    // Now a module imports it directly. It has no module of its own yet, so it
    // must be bundled again instead of being treated as cached.
    await dev.write(
      "index.ts",
      `
        import styles from "./button.module.css";
        import base from "./base.module.css";
        console.log("base:" + Object.keys(base).join(",") + " " + (styles.btn.split(" ")[0] === base.base));
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("base:base true");
  },
});
devTest("two importers share one css module instance", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "styles.module.css": `
      .shared { color: red; }
    `,
    "a.ts": `
      import styles from "./styles.module.css";
      export const mapA = styles;
    `,
    "b.ts": `
      import styles from "./styles.module.css";
      export const mapB = styles;
    `,
    "index.ts": `
      import { mapA } from "./a";
      import { mapB } from "./b";
      console.log("same:" + (mapA === mapB) + " " + mapA.shared);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    const msg = await c.getStringMessage();
    assert(msg.startsWith("same:true shared_"), msg);
  },
});
devTest("emptying a css module removes its styles and class map", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<h1>Hello</h1>`,
    }),
    "styles.module.css": `
      .title { color: red; }
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      document.querySelector("h1").className = styles.title ?? "";
      console.log("keys:" + Object.keys(styles).sort().join(","));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("keys:title");
    const className = await c.js<string>`document.querySelector("h1").className`;
    await c.style("." + className).color.expect.toBe("red");

    await dev.write("styles.module.css", " ", { dedent: false });
    await c.expectMessage("keys:");
    await c.style("." + className).notFound();

    await dev.write("styles.module.css", `.title { color: blue; }`);
    await c.expectMessage("keys:title");
    await c.style("." + className).color.expect.toBe("#00f");
  },
});
devTest("plain css import stays side-effect only next to css modules", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "plain.css": `
      body { color: red; }
    `,
    "index.ts": `
      import "./plain.css";
      globalThis.evalCount = (globalThis.evalCount ?? 0) + 1;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style("body").color.expect.toBe("red");
    await dev.patch("plain.css", { find: "red", replace: "blue" });
    await c.style("body").color.expect.toBe("#00f");
    expect(await c.js<number>`globalThis.evalCount`).toBe(1);
  },
});
devTest("plain css imported with a binding is an empty module, as in bun build", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "plain.css": `
      body { color: red; }
    `,
    "other.css": `
      h1 { color: blue; }
    `,
    "index.ts": `
      import sheet from "./plain.css";
      import * as ns from "./other.css";
      console.log(JSON.stringify({ sheet, ns: Object.keys(ns), nsDefault: ns.default }));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(JSON.stringify({ sheet: {}, ns: ["default"], nsDefault: {} }));
    await c.style("body").color.expect.toBe("red");
    await c.style("h1").color.expect.toBe("#00f");
    // The same holds when the importer is bundled again and the stylesheets are cached.
    await dev.patch("index.ts", { find: "JSON.stringify({", replace: `"again:" + JSON.stringify({` });
    await c.expectMessage("again:" + JSON.stringify({ sheet: {}, ns: ["default"], nsDefault: {} }));
  },
});
devTest("plain css with an initial syntax error, imported with a binding", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "plain.css": `
      body {
        color: red;
      }}
    `,
    "index.ts": `
      import sheet from "./plain.css";
      console.log("sheet:" + JSON.stringify(sheet));
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["plain.css:3:3: error: Unexpected end of input"],
    });
    // The importer is not bundled again when the stylesheet is fixed. Its binding must exist.
    await c.expectReload(async () => {
      await dev.write(
        "plain.css",
        `
          body {
            color: red;
          }
        `,
      );
    });
    await c.expectMessage("sheet:{}");
    await c.style("body").color.expect.toBe("red");
  },
});
devTest("css module with an initial syntax error gets recovered", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<h1>Hello</h1>`,
    }),
    "styles.module.css": `
      .title {
        color: red;
      }}
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      document.querySelector("h1").className = styles.title;
      console.log("keys:" + Object.keys(styles).join(","));
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["styles.module.css:3:3: error: Unexpected end of input"],
    });
    // The importer is not bundled again when the stylesheet is fixed. Its
    // import must still link to the class names once they exist.
    await c.expectReload(async () => {
      await dev.write(
        "styles.module.css",
        `
          .title {
            color: red;
          }
        `,
      );
    });
    await c.expectMessage("keys:title");
    await c.style("." + (await c.js<string>`document.querySelector("h1").className`)).color.expect.toBe("red");
  },
});
devTest("css module class names survive a syntax error", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "styles.module.css": `
      .title {
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      console.log("keys:" + Object.keys(styles).sort().join(","));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("keys:title");
    await dev.write(
      "styles.module.css",
      `
        .title {
          color: red;
        }}
      `,
      {
        errors: ["styles.module.css:3:3: error: Unexpected end of input"],
      },
    );
    await dev.write(
      "styles.module.css",
      `
        .extra { color: blue; }
        .title {
          color: red;
        }
      `,
    );
    await c.expectMessage("keys:extra,title");
  },
});
devTest("css module with a composes of an unknown name is a build error", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "styles.module.css": `
      .title {
        composes: missing;
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      console.log("title:" + styles.title.split(" ").length);
      globalThis.titleClass = styles.title.split(" ").find(name => name.startsWith("title"));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    const error =
      'styles.module.css:2:12: error: The name "missing" never appears in "styles.module.css" as a CSS modules locally scoped class name. Note that "composes" only works with single class selectors.';
    await using c = await dev.client("/", { errors: [error] });
    await c.expectReload(async () => {
      await dev.write(
        "styles.module.css",
        `
          .missing { font-weight: 700; }
          .title {
            composes: missing;
            color: red;
          }
        `,
      );
    });
    await c.expectMessage("title:2");
    const title = "." + (await c.js<string>`globalThis.titleClass`);
    await c.style(title).color.expect.toBe("red");
    // The same error after a good build. The page keeps its last good stylesheet.
    await dev.write(
      "styles.module.css",
      `
        .title {
          composes: missing;
          color: blue;
        }
      `,
      { errors: [error] },
    );
    await c.style(title).color.expect.toBe("red");
    await dev.write(
      "styles.module.css",
      `
        .title {
          color: red;
        }
      `,
    );
    await c.expectMessage("title:1");
  },
});
devTest("css module that composes from a stylesheet with a syntax error", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "base.module.css": `
      .base {
        font-weight: 700;
      }}
    `,
    "button.module.css": `
      .btn {
        composes: base from "./base.module.css";
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./button.module.css";
      console.log("btn:" + styles.btn.split(" ").length);
    `,
  },
  async test(dev) {
    // Only the stylesheet with the syntax error reports one.
    await using c = await dev.client("/", {
      errors: ["base.module.css:3:3: error: Unexpected end of input"],
    });
    // Fixing it bundles the file that composes from it again.
    await c.expectReload(async () => {
      await dev.write(
        "base.module.css",
        `
          .base {
            font-weight: 700;
          }
        `,
      );
    });
    await c.expectMessage("btn:2");
  },
});
devTest("css module with a composes error that the other file fixes", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "base.module.css": `
      #base {
        font-weight: 700;
      }
    `,
    "button.module.css": `
      .btn {
        composes: base from "./base.module.css";
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./button.module.css";
      console.log("btn:" + styles.btn.split(" ").length);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [
        'button.module.css:2:11: error: The composes property cannot be used with "base", because it is not a single class name.',
      ],
    });
    await c.expectReload(async () => {
      await dev.write(
        "base.module.css",
        `
          .base {
            font-weight: 700;
          }
        `,
      );
    });
    await c.expectMessage("btn:2");
  },
});
devTest("css module in a link tag with an initial syntax error gets recovered", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.module.css"],
      body: `hello world`,
    }),
    "styles.module.css": `
      body {
        color: red;
      }}
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["styles.module.css:3:3: error: Unexpected end of input"],
    });
    await c.expectReload(async () => {
      await dev.write(
        "styles.module.css",
        `
          body {
            color: red;
          }
        `,
      );
    });
    await c.style("body").color.expect.toBe("red");
    // The page links the bundled stylesheet, not the source file.
    await dev.fetch("/").expect.not.toContain('"styles.module.css"');
  },
});

// The tests below run a framework with a server graph. A CSS module is a module
// in each graph that imports it, and all graphs get the same names.
const declineCssModules = `
  export default [
    {
      name: "decline",
      setup(build) {
        build.onResolve({ filter: /[.]module[.]css$/ }, () => undefined);
      },
    },
  ];
`;
const frameworkWithClientEntry = (separateSSRGraph: boolean) => ({
  fileSystemRouterTypes: [{ ...minimalFramework.fileSystemRouterTypes![0], clientEntryPoint: "./client.ts" }],
  serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph },
});
// The source of a response that links the stylesheets and scripts of the route around `body`.
const htmlPage = (body: string) => `new Response(
    "<!doctype html><html><head>" +
      meta.styles.map(href => '<link rel="stylesheet" href="' + href + '">').join("") +
      "</head><body>" + ${body} +
      meta.modules.map(src => '<script type="module" src="' + src + '"></script>').join("") +
      "</body></html>",
    { headers: { "content-type": "text/html" } },
  )`;
for (const graph of ["server", "ssr"] as const) {
  devTest(`css module names reach a render in the ${graph} graph`, {
    framework: {
      ...minimalFramework,
      serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: graph === "ssr" },
    },
    files: {
      "styles.module.css": `
        .title { color: red; }
      `,
      "other.ts": `
        import styles from "./styles.module.css";
        export const fromOther = () => styles;
        export const required = () => require("./styles.module.css");
      `,
      "page.ts": `
        import styles, { title } from "./styles.module.css";
        import * as ns from "./styles.module.css";
        import { fromOther, required } from "./other.ts";
        globalThis.pageEvals = (globalThis.pageEvals ?? 0) + 1;
        export async function render() {
          const dyn = await import("./styles.module.css");
          globalThis.firstStyles ??= styles;
          return Response.json({
            v: 1,
            keys: Object.keys(styles).sort(),
            scoped: styles.title.startsWith("title_"),
            shapes: [title === styles.title, ns.default === styles, dyn.default === styles, required() === styles, fromOther() === styles],
            evals: globalThis.pageEvals,
            sameModule: styles === globalThis.firstStyles,
          });
        }
      `,
      "routes/index.ts": `
        import { render } from "../page.ts"${graph === "ssr" ? ` with { bunBakeGraph: "ssr" }` : ""};
        export default () => render();
      `,
    },
    async test(dev) {
      const first = {
        v: 1,
        keys: ["title"],
        scoped: true,
        shapes: [true, true, true, true, true],
        evals: 1,
        sameModule: true,
      };
      await dev.fetch("/").equals(first);
      // A save that changes no class name sends no class-name module to the server.
      await dev.patch("styles.module.css", { find: "red", replace: "blue" });
      await dev.fetch("/").equals(first);
      // The importer is bundled again while the stylesheet is cached.
      await dev.patch("page.ts", { find: "v: 1", replace: "v: 2" });
      await dev.fetch("/").equals({ ...first, v: 2, evals: 2 });
      // A new class reaches the next render, in a new module. The importer is not evaluated again.
      await dev.write(
        "styles.module.css",
        `
          .extra { color: green; }
          .title { color: blue; }
        `,
      );
      await dev.fetch("/").equals({ ...first, v: 2, keys: ["extra", "title"], evals: 2, sameModule: false });
    },
  });
}
for (const separateSSRGraph of [false, true]) {
  for (const plugin of ["no plugin", "an onResolve plugin that declines"] as const) {
    devTest(`css module names agree in every graph (separateSSRGraph: ${separateSSRGraph}, ${plugin})`, {
      framework: frameworkWithClientEntry(separateSSRGraph),
      pluginFile: plugin === "no plugin" ? undefined : declineCssModules,
      files: {
        "styles.module.css": `
          .title { color: lab(50% 40 30); }
        `,
        "components/Widget.ts": `
          "use client";
          import styles from "../styles.module.css";
          export const widget = () => styles.title;
        `,
        "ssr.ts": `
          import styles from "./styles.module.css";
          export const ssrTitle = () => styles.title;
        `,
        "routes/index.ts": `
          import styles from "../styles.module.css";
          import { widget } from "../components/Widget.ts";
          import { ssrTitle } from "../ssr.ts"${separateSSRGraph ? ` with { bunBakeGraph: "ssr" }` : ""};
          export default function (req, meta) {
            const body = "<p id='server'>" + styles.title + "</p><p id='ssr'>" + ssrTitle() + "</p><p>" + typeof widget + "</p>";
            return ${htmlPage("body")};
          }
        `,
        "client.ts": `
          import { widget } from "./components/Widget.ts";
          console.log("client:" + widget());
        `,
      },
      async test(dev) {
        await using c = await dev.client("/");
        const title = (await c.getStringMessage()).slice("client:".length);
        expect(title).toStartWith("title_");
        expect(
          await c.js<string[]>`[
            document.querySelector("#server").textContent,
            document.querySelector("#ssr").textContent,
            document.styleSheets[0].cssRules[0].selectorText,
          ]`,
        ).toEqual([title, title, "." + title]);
        // The page gets the stylesheet of the browser's copy, which has the fallbacks for the color.
        const href = await c.js<string>`document.querySelector("link[rel=stylesheet]").getAttribute("href")`;
        expect(await dev.fetch(href).text()).toContain("color(display-p3");
      },
    });
  }
}
devTest("css module imported by a client file after a server file", {
  framework: frameworkWithClientEntry(false),
  files: {
    "styles.module.css": `
      .title { color: red; }
    `,
    "routes/index.ts": `
      import styles from "../styles.module.css";
      export default function (req, meta) {
        return ${htmlPage(`"<p id='server'>" + styles.title + "</p>"`)};
      }
    `,
    "client.ts": `
      console.log("client:none");
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("client:none");
    const title = await c.js<string>`document.querySelector("#server").textContent`;
    expect(title).toStartWith("title_");
    // The stylesheet is cached, but the client graph has no class-name module for it yet.
    await dev.write(
      "client.ts",
      `
        import styles from "./styles.module.css";
        console.log("client:" + styles.title);
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("client:" + title);
    await c.style("." + title).color.expect.toBe("red");
  },
});
devTest("css module imported by a server file after a client file", {
  framework: frameworkWithClientEntry(false),
  files: {
    "styles.module.css": `
      .title { color: red; }
    `,
    "routes/index.ts": `
      export default function (req, meta) {
        return ${htmlPage(`"<p id='server'>none</p>"`)};
      }
    `,
    "client.ts": `
      import styles from "./styles.module.css";
      console.log("client:" + styles.title);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    const title = (await c.getStringMessage()).slice("client:".length);
    expect(title).toStartWith("title_");
    // The stylesheet is cached, but the server graph has no class-name module for it yet.
    await c.expectReload(async () => {
      await dev.write(
        "routes/index.ts",
        `
          import styles from "../styles.module.css";
          export default function (req, meta) {
            return ${htmlPage(`"<p id='server'>" + styles.title + "</p>"`)};
          }
        `,
      );
    });
    await c.expectMessage("client:" + title);
    expect(await c.js<string>`document.querySelector("#server").textContent`).toBe(title);
  },
});
for (const graph of ["server", "ssr"] as const) {
  devTest(`css module composes and errors in the ${graph} graph`, {
    framework: {
      ...minimalFramework,
      serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: graph === "ssr" },
    },
    files: {
      "base.module.css": `
        #base { font-weight: 700; }
      `,
      "button.module.css": `
        .btn {
          composes: base from "./base.module.css";
          color: red;
        }
      `,
      "page.ts": `
        import styles from "./button.module.css";
        export const render = () =>
          new Response(styles.btn.split(" ").map(name => name.replace(/_.*/, "")).sort().join(","));
      `,
      "routes/index.ts": `
        import { render } from "../page.ts"${graph === "ssr" ? ` with { bunBakeGraph: "ssr" }` : ""};
        export default () => render();
      `,
    },
    async test(dev) {
      const composesBase = `
        .btn {
          composes: base from "./base.module.css";
          color: red;
        }
      `;
      // The first bundle fails on `composes`. A fix in the other file bundles the module again.
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write(
        "base.module.css",
        `
          .base { font-weight: 700; }
        `,
      );
      await dev.fetch("/").equals("base,btn");
      // A change of what the other file composes changes this module's names.
      await dev.write(
        "base.module.css",
        `
          .extra { font-style: italic; }
          .base { composes: extra; font-weight: 700; }
        `,
      );
      await dev.fetch("/").equals("base,btn,extra");
      // A save adds a `composes` error after a good build. Each request gets the error until the fix.
      await dev.write("button.module.css", `.btn { composes: missing; color: red; }`, { errors: null });
      expect((await dev.fetch("/")).status).toBe(500);
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("button.module.css", composesBase);
      await dev.fetch("/").equals("base,btn,extra");
      // The same, with the error and the fix in the other file.
      await dev.write("base.module.css", `#base { font-weight: 700; }`, { errors: null });
      expect((await dev.fetch("/")).status).toBe(500);
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("base.module.css", `.base { font-weight: 700; }`);
      await dev.fetch("/").equals("base,btn");
      // A syntax error, then the fix.
      await dev.write("button.module.css", `.btn { color: red; }}`, { errors: null });
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("button.module.css", `.btn { color: red; }`);
      await dev.fetch("/").equals("btn");
    },
  });
}
devTest("css module of a server file is deleted and restored", {
  skip: [
    "win32", // unlinkSync is having weird behavior
  ],
  framework: minimalFramework,
  files: {
    "styles.module.css": `
      .title { color: red; }
    `,
    "routes/index.ts": `
      import styles from "../styles.module.css";
      export default function () {
        return new Response(Object.keys(styles).sort().join(","));
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("title");
    await dev.delete("styles.module.css", { errors: null });
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("styles.module.css", `.title { color: red; }\n.again { color: blue; }`);
    await dev.fetch("/").equals("again,title");
  },
});
for (const graph of ["server", "ssr"] as const) {
  devTest(`css module in the ${graph} graph with an import of a file that is not css`, {
    framework: {
      ...minimalFramework,
      serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: graph === "ssr" },
    },
    files: {
      "theme.json": `{}`,
      "styles.module.css": `
        @import "./theme.json";
        .title { color: red; }
      `,
      "page.ts": `
        import styles from "./styles.module.css";
        export const render = () => new Response(Object.keys(styles).sort().join(","));
      `,
      "routes/index.ts": `
        import { render } from "../page.ts"${graph === "ssr" ? ` with { bunBakeGraph: "ssr" }` : ""};
        export default () => render();
      `,
    },
    async test(dev) {
      // Each request gets the build error until the stylesheet is fixed.
      expect((await dev.fetch("/")).status).toBe(500);
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("styles.module.css", `.title { color: red; }`);
      await dev.fetch("/").equals("title");
      // The same error after a good build. The route keeps no class name of the failed save.
      await dev.write("styles.module.css", `@import "./theme.json";\n.bad { color: red; }`, { errors: null });
      expect((await dev.fetch("/")).status).toBe(500);
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("styles.module.css", `.title { color: red; }\n.extra { color: blue; }`);
      await dev.fetch("/").equals("extra,title");
    },
  });
}
for (const graph of ["server", "ssr"] as const) {
  devTest(`css module in the ${graph} graph composes from a stylesheet with a syntax error`, {
    framework: {
      ...minimalFramework,
      serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: graph === "ssr" },
    },
    files: {
      "base.module.css": `.base { font-weight: 700; }}`,
      "button.module.css": `
        .btn {
          composes: base from "./base.module.css";
          color: red;
        }
      `,
      "page.ts": `
        import styles from "./button.module.css";
        export const render = () =>
          new Response(styles.btn.split(" ").map(name => name.replace(/_.*/, "")).sort().join(","));
      `,
      "routes/index.ts": `
        import { render } from "../page.ts"${graph === "ssr" ? ` with { bunBakeGraph: "ssr" }` : ""};
        export default () => render();
      `,
    },
    async test(dev) {
      // No graph has the browser's copy of these files. Each request still gets the error of the composed file.
      expect((await dev.fetch("/")).status).toBe(500);
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("base.module.css", `.base { font-weight: 700; }`);
      await dev.fetch("/").equals("base,btn");
      await dev.write("base.module.css", `.base { font-weight: 700; }}`, { errors: null });
      expect((await dev.fetch("/")).status).toBe(500);
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("base.module.css", `.base { font-weight: 700; }`);
      await dev.fetch("/").equals("base,btn");
    },
  });
}
for (const root of ["root.css", "root.module.css"]) {
  devTest(`stylesheet of a server file imports a stylesheet with a syntax error (${root})`, {
    framework: minimalFramework,
    files: {
      "child.css": `.child { color: red; }}`,
      [root]: `
        @import "./child.css";
        .root { color: red; }
      `,
      "routes/index.ts": `
        import "../${root}";
        export default function (req, meta) {
          return Response.json(meta.styles);
        }
      `,
    },
    async test(dev) {
      // The route finds the failure of the imported file through the stylesheet that it imports.
      expect((await dev.fetch("/")).status).toBe(500);
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("child.css", `.child { color: red; }`);
      const styles = (await (await dev.fetch("/")).json()) as string[];
      expect(await dev.fetch(styles[0]).text()).toContain(".child {");
      // No failure stays behind for a later request.
      expect((await dev.fetch("/")).status).toBe(200);
    },
  });
}
devTest("stylesheet of a server file and a client file imports a stylesheet that is broken and fixed", {
  framework: frameworkWithClientEntry(false),
  // By default, a request for a route with a build error bundles the whole route again. That hides a record that went wrong.
  env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
  files: {
    "child.css": `.child { color: red; }`,
    "root.css": `
      @import "./child.css";
      .root { color: red; }
    `,
    "client.ts": `
      import "./root.css";
    `,
    "routes/index.ts": `
      import "../root.css";
      export default function (req, meta) {
        return Response.json({ v: 1, styles: meta.styles });
      }
    `,
  },
  async test(dev) {
    const css = async () => {
      const res = await dev.fetch("/");
      expect(res.status).toBe(200);
      const { styles } = (await res.json()) as { styles: string[] };
      return await dev.fetch(styles[0]).text();
    };
    expect(await css()).toContain(".child {");
    await dev.write("child.css", `.child { color: red; }}`, { errors: null });
    // The page has the browser's copy of root.css. This bundles the server's copy, with the broken file.
    await dev.patch("routes/index.ts", { find: "v: 1", replace: "v: 2", errors: null });
    expect((await dev.fetch("/")).status).toBe(500);
    // The fix bundles root.css again.
    await dev.write("child.css", `.fixed { color: red; }`);
    expect(await css()).toContain(".fixed {");
  },
});
devTest("css module of two graphs keeps the browser's stylesheet when the client graph grows past 512 files", {
  framework: frameworkWithClientEntry(false),
  files: {
    ...Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`m/${i}.ts`, `export const v${i} = ${i};`])),
    "client.ts": [
      ...Array.from({ length: 520 }, (_, i) => `import "./m/${i}.ts";`),
      `import "./styles.module.css";`,
      `import "./broken.module.css";`,
    ].join("\n"),
    "styles.module.css": `.title { color: lab(50% 40 30); }`,
    "broken.module.css": `.b { composes: missing; color: red; }`,
    "routes/index.ts": `
      import styles from "../styles.module.css";
      export default function (req, meta) {
        return Response.json({ title: styles.title, styles: meta.styles });
      }
    `,
  },
  async test(dev) {
    // The failure of the other module is recorded after the browser's copy of styles.module.css is stored.
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("broken.module.css", `.b { color: red; }`);
    const { title, styles } = (await (await dev.fetch("/")).json()) as { title: string; styles: string[] };
    const sheets = await Promise.all(styles.map(href => dev.fetch(href).text()));
    // Only the browser's copy has the fallbacks for the color.
    expect(sheets.find(css => css.includes("." + title))).toContain("color(display-p3");
  },
});
devTest("css file that imports a file that is not css does not kill old styles", {
  files: {
    "theme.json": `{}`,
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
        @import "./theme.json";
        body {
          color: blue;
        }
      `,
      {
        errors: [`styles.css:1:1: error: Cannot import a ".json" file into a CSS file`],
      },
    );
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
  },
});
devTest("css module class names survive an import of a file that is not css", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "theme.json": `{}`,
    "styles.module.css": `
      .title {
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./styles.module.css";
      console.log("keys:" + Object.keys(styles).sort().join(","));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("keys:title");
    // The failed save sends no class-name module: the importer does not run with `bad`.
    await dev.write(
      "styles.module.css",
      `
        @import "./theme.json";
        .bad { color: blue; }
        .title {
          color: red;
        }
      `,
      {
        errors: [`styles.module.css:1:1: error: Cannot import a ".json" file into a CSS file`],
      },
    );
    await c.style(".title_-MSaAA").color.expect.toBe("red");
    await dev.write(
      "styles.module.css",
      `
        .extra { color: blue; }
        .title {
          color: red;
        }
      `,
    );
    await c.expectMessage("keys:extra,title");
  },
});
devTest("css module with an initial import of a file that is not css, under two importers", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "theme.json": `{}`,
    "styles.module.css": `
      @import "./theme.json";
      .title { color: red; }
    `,
    // `late.ts` is found after the stylesheet, so it adds the stylesheet to the roots a second time.
    "index.ts": `
      import styles from "./styles.module.css";
      import { late } from "./mid.ts";
      console.log("keys:" + Object.keys(styles).join(",") + ":" + late());
    `,
    "mid.ts": `
      export { late } from "./late.ts";
    `,
    "late.ts": `
      import styles from "./styles.module.css";
      export const late = () => Object.keys(styles).join(",");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [`styles.module.css:1:1: error: Cannot import a ".json" file into a CSS file`],
    });
    await c.expectReload(async () => {
      await dev.write("styles.module.css", `.title { color: red; }`);
    });
    await c.expectMessage("keys:title:title");
  },
});
devTest("css module with a composes of an unknown name from another file is a build error", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "base.module.css": `
      .base { font-weight: 700; }
    `,
    "button.module.css": `
      .btn {
        composes: typo from "./base.module.css";
        color: red;
      }
    `,
    "index.ts": `
      import styles from "./button.module.css";
      console.log("btn:" + styles.btn.split(" ").map(name => name.replace(/_.*/, "")).sort().join(","));
    `,
  },
  async test(dev) {
    // The error of `bun build`, which the link step reports there.
    const [response] = await Promise.all([
      dev.fetch("/"),
      dev.output.waitForLine(
        /The name "typo" never appears in "base\.module\.css" as a CSS modules locally scoped class name/,
      ),
    ]);
    expect(response.status).toBe(500);
    await dev.write(
      "button.module.css",
      `
        .btn {
          composes: base from "./base.module.css";
          color: red;
        }
      `,
    );
    await using c = await dev.client("/");
    await c.expectMessage("btn:base,btn");
  },
});
for (const graph of ["server", "ssr"] as const) {
  devTest(`css module style edit sends no class-name module to the ${graph} graph`, {
    framework: frameworkWithClientEntry(graph === "ssr"),
    files: {
      "styles.module.css": `
        .title { color: red; }
      `,
      "names.ts": `
        import styles from "./styles.module.css";
        export const title = () => styles.title;
      `,
      "routes/index.ts": `
        import { title } from "../names.ts"${graph === "ssr" ? ` with { bunBakeGraph: "ssr" }` : ""};
        export default function (req, meta) {
          return ${htmlPage(`"<p id='server'>" + title() + "</p>"`)};
        }
      `,
      "client.ts": `
        import styles from "./styles.module.css";
        console.log("client:" + styles.title);
        import.meta.hot.accept();
      `,
    },
    async test(dev) {
      await using c = await dev.client("/");
      const title = (await c.getStringMessage()).slice("client:".length);
      expect(await c.js<string>`document.querySelector("#server").textContent`).toBe(title);
      // A module for the server would reload the page, and the client fails the test on a reload.
      await dev.patch("styles.module.css", { find: "red", replace: "green" });
      await c.style("." + title).color.expect.toBe("green");
    },
  });
}
devTest("css module keyframes get the exported name in the ssr graph", {
  framework: {
    ...minimalFramework,
    serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: true },
  },
  files: {
    "styles.module.css": `
      @keyframes spin { to { rotate: 360deg; } }
      .title { animation-name: spin; }
    `,
    "page.ts": `
      import styles from "./styles.module.css";
      export const names = () => styles;
    `,
    "routes/index.ts": `
      import { names } from "../page.ts" with { bunBakeGraph: "ssr" };
      export default function (req, meta) {
        return Response.json({ spin: names().spin, styles: meta.styles });
      }
    `,
  },
  async test(dev) {
    const { spin, styles } = (await (await dev.fetch("/")).json()) as { spin: string; styles: string[] };
    expect(spin).toStartWith("spin_");
    const css = await dev.fetch(styles[0]).text();
    expect(css).toContain("@keyframes " + spin);
    expect(css).toContain("animation-name: " + spin);
  },
});
for (const [first, second] of [
  ["/", "/other"],
  ["/other", "/"],
]) {
  devTest(`css module reaches the graph of ${second} after ${first} bundled it for its graph`, {
    framework: {
      ...minimalFramework,
      serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: true },
    },
    files: {
      "styles.module.css": `
        .title { color: red; }
      `,
      "ssr.ts": `
        import styles from "./styles.module.css";
        export const render = () => Response.json({ keys: Object.keys(styles).sort(), title: styles.title });
      `,
      "routes/index.ts": `
        import styles from "../styles.module.css";
        export default () => Response.json({ keys: Object.keys(styles).sort(), title: styles.title });
      `,
      "routes/other.ts": `
        import { render } from "../ssr.ts" with { bunBakeGraph: "ssr" };
        export default () => render();
      `,
    },
    async test(dev) {
      const one = (await (await dev.fetch(first)).json()) as { keys: string[]; title: string };
      expect(one).toEqual({ keys: ["title"], title: expect.stringMatching(/^title_/) });
      // The stylesheet is cached for one graph. The other graph has no class-name module for it yet.
      await dev.fetch(second).equals(one);
      await dev.patch("styles.module.css", { find: "red", replace: "blue" });
      await dev.fetch(first).equals(one);
      await dev.fetch(second).equals(one);
      // A new class reaches both graphs.
      await dev.write(
        "styles.module.css",
        `
          .extra { color: green; }
          .title { color: blue; }
        `,
      );
      const two = { keys: ["extra", "title"], title: one.title };
      await dev.fetch(first).equals(two);
      await dev.fetch(second).equals(two);
    },
  });
}
// The source of a route that prints what the server-side copy of `components/Widget.ts` exports.
const widgetRoute = (separateSSRGraph: boolean) => `
  import * as Widget from "../components/Widget.ts";
  import { ssrManifest } from "bun:bake/server";
  export default async function (req, meta) {
    ${
      separateSSRGraph
        ? `const uid = Object.keys(ssrManifest).find(key => key.includes("Widget"));
    const server = (await import(ssrManifest[uid].keys.specifier)).keys();`
        : `const server = Widget.keys.value();`
    }
    return ${htmlPage(`"<p id='server'>" + server + "</p>"`)};
  }
`;
for (const separateSSRGraph of [false, true]) {
  devTest(`css module of a "use client" file is saved with a page open (separateSSRGraph: ${separateSSRGraph})`, {
    framework: frameworkWithClientEntry(separateSSRGraph),
    files: {
      "styles.module.css": `
        .title { color: red; }
      `,
      "components/Widget.ts": `
        "use client";
        import styles from "../styles.module.css";
        export const keys = () => "v1:" + Object.keys(styles).sort().join(",");
        if (typeof window !== "undefined") console.log("widget:" + keys());
        import.meta.hot.accept();
      `,
      "routes/index.ts": widgetRoute(separateSSRGraph),
      "client.ts": `
        import "./components/Widget.ts";
      `,
    },
    async test(dev) {
      const server = async () => (await dev.fetch("/").text()).match(/<p id='server'>([^<]*)/)?.[1];
      await using c = await dev.client("/");
      await c.expectMessage("widget:v1:title");
      // A style-only save evaluates nothing. A reload fails the test.
      await dev.patch("styles.module.css", { find: "red", replace: "green" });
      await c.style(".title_-MSaAA").color.expect.toBe("green");
      expect(await server()).toBe("v1:title");
      // A new class reaches the page and the server-side copy of the component.
      await dev.write("styles.module.css", `.extra { color: blue; }\n.title { color: green; }`);
      await c.expectMessage("widget:v1:extra,title");
      expect(await server()).toBe("v1:extra,title");
      // The component is bundled again while the stylesheet is cached.
      await dev.patch("components/Widget.ts", { find: "v1:", replace: "v2:" });
      await c.expectMessage("widget:v2:extra,title");
      expect(await server()).toBe("v2:extra,title");
    },
  });
}
devTest("css module that a tailwind plugin tracks is loaded once for a save of another file", {
  framework: minimalFramework,
  files: {
    // The dev server bundles a stylesheet with "tailwind" in its output again on each save, if a plugin has that name.
    "bunfig.toml": `
      [serve.static]
      plugins = ["./tailwind-stub.ts"]
    `,
    "tailwind-stub.ts": `
      export default {
        name: "tailwind-stub",
        setup(build) {
          build.onLoad({ filter: /[.]module[.]css$/ }, args => {
            (globalThis.cssLoads ??= []).push(args.side);
            return undefined;
          });
        },
      };
    `,
    "styles.module.css": `
      /*! tailwindcss */
      .title { color: red; }
    `,
    "other.ts": `
      export const v = 1;
    `,
    "routes/index.ts": `
      import styles from "../styles.module.css";
      import { v } from "../other.ts";
      export default function () {
        const loads = (globalThis.cssLoads ?? []).sort();
        globalThis.cssLoads = [];
        return Response.json({ v, keys: Object.keys(styles).sort(), loads });
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({ v: 1, keys: ["title"], loads: ["server"] });
    // This bundles the browser's copy only, as for a plain stylesheet.
    await dev.write("other.ts", `export const v = 2;`);
    await dev.fetch("/").equals({ v: 2, keys: ["title"], loads: ["client"] });
    // A save of the stylesheet bundles the copy of each graph.
    await dev.write("styles.module.css", `/*! tailwindcss */\n.title { color: red; }\n.extra { color: blue; }`);
    await dev.fetch("/").equals({ v: 2, keys: ["extra", "title"], loads: ["client", "server"] });
  },
});
// A debug or ASAN build holds freed memory back, so only a release build can bound the growth.
if (!isASAN && !isDebug) {
  const manyClasses = (color: string) =>
    Array.from({ length: 2000 }, (_, i) => `.c${i} { color: ${color}; }`).join("\n");
  devTest("css module saves do not grow the memory of the dev server", {
    framework: minimalFramework,
    files: {
      "big.module.css": manyClasses("red"),
      "routes/index.ts": `
        import styles from "../big.module.css";
        export default function () {
          Bun.gc(true);
          return Response.json({ classes: Object.keys(styles).length, rss: process.memoryUsage.rss() });
        }
      `,
    },
    async test(dev) {
      const rss = async () => ((await (await dev.fetch("/")).json()) as { rss: number }).rss;
      const save = (i: number) => dev.write("big.module.css", manyClasses(i % 2 ? "red" : "blue"));
      await rss();
      for (let i = 0; i < 5; i++) await save(i);
      const before = await rss();
      for (let i = 0; i < 30; i++) await save(i);
      // With no scope for its AST nodes, the class-name map of each copy stays: 35 MB here. With one: 8 MB.
      expect((await rss()) - before).toBeLessThan(16 * 1024 * 1024);
    },
  });
}

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
