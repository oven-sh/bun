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

// The dev server serves a stylesheet apart from its modules. `require()` and `import()` of a plain stylesheet
// give the values of a bundle from `bun build`, however the dev server got the stylesheet.
// The page logs `typeof` with each value, because a function does not reach the test over JSON.
const shapeOf = `const shape = (value: unknown) => typeof value + " " + JSON.stringify(value);`;
// `pass` tells one bundle of the importer from the next. A rejected `import()` is logged as its message.
const readsStylesheets = (pass: string, sheets: string[]) => `
  ${shapeOf}
  const required = [${sheets.map(sheet => `require("./${sheet}")`).join(", ")}].map(shape);
  const pending = [${sheets.map(sheet => `import("./${sheet}")`).join(", ")}];
  const promises = pending.map(value => value instanceof Promise);
  Promise.all(pending)
    .then(imported => imported.map(shape), String)
    .then(imported => console.log({ pass: ${JSON.stringify(pass)}, required, promises, imported }));
  import.meta.hot.accept();
`;
const emptyModules = (pass: string, count: number) => ({
  pass,
  required: Array(count).fill("object {}"),
  promises: Array(count).fill(true),
  imported: Array(count).fill('object {"default":{}}'),
});
devTest("require() and import() of a stylesheet give an empty module", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "a.css": `.a { color: red; }`,
    "b.css": `.b { color: green; }`,
    "app.ts": readsStylesheets("bundled together", ["a.css"]),
    "second.ts": readsStylesheets("another page", ["a.css"]),
  },
  async test(dev) {
    await using c = await dev.client("/index");
    await c.expectMessage(emptyModules("bundled together", 1));
    await c.style(".a").color.expect.toBe("red");

    // The stylesheet is not bundled again for a page that is loaded later.
    // The importer gets the stylesheet from the cache of the dev server.
    {
      await using other = await dev.client("/second");
      await other.expectMessage(emptyModules("another page", 1));
      await other.style(".a").color.expect.toBe("red");
    }

    // The same is true when only the importer is edited.
    await dev.write("app.ts", readsStylesheets("importer edited", ["a.css"]));
    await c.expectMessage(emptyModules("importer edited", 1));
    await c.style(".a").color.expect.toBe("red");

    {
      await using batch = await dev.batchChanges();
      await dev.write("app.ts", readsStylesheets("both edited", ["a.css"]));
      await dev.write("a.css", `.a { color: blue; }`);
    }
    await c.expectMessage(emptyModules("both edited", 1));
    await c.style(".a").color.expect.toBe("#00f");

    // A stylesheet that is new to the dev server, beside one from its cache.
    await dev.write("app.ts", readsStylesheets("stylesheet added", ["a.css", "b.css"]));
    await c.expectMessage(emptyModules("stylesheet added", 2));
    await c.style(".a").color.expect.toBe("#00f");
    await c.style(".b").color.expect.toBe("green");

    // The page has a stylesheet only while a module requires it.
    await dev.write("app.ts", readsStylesheets("stylesheet removed", ["b.css"]));
    await c.expectMessage(emptyModules("stylesheet removed", 1));
    await c.style(".a").notFound();
    await dev.write("app.ts", readsStylesheets("stylesheet required again", ["a.css", "b.css"]));
    await c.expectMessage(emptyModules("stylesheet required again", 2));
    await c.style(".a").color.expect.toBe("#00f");
  },
});
devTest("require() and import() of a stylesheet that failed to build with its importer", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "a.css": `.a { color: red; }}`,
    "app.ts": readsStylesheets("stylesheet repaired", ["a.css"]),
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["a.css:1:20: error: Unexpected end of input"],
    });
    // The importer is not bundled again.
    await c.expectReload(async () => {
      await dev.write("a.css", `.a { color: red; }`);
    });
    await c.expectMessage(emptyModules("stylesheet repaired", 1));
    await c.style(".a").color.expect.toBe("red");
  },
});
devTest("require() of a stylesheet in CommonJS, in a package, in try, and as a TypeScript import", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["forms.ts"] }),
    "a.css": `.a { color: red; }`,
    "legacy.cjs": `
      require("./a.css");
      module.exports = require("./a.css");
    `,
    "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", main: "index.js" }),
    "node_modules/pkg/index.js": `
      require("./pkg.css");
      exports.loaded = true;
    `,
    "node_modules/pkg/pkg.css": `.pkg { color: blue; }`,
    "forms.ts": `
      import inCommonJS from "./legacy.cjs";
      import { loaded as inPackage } from "pkg";
      import inTypeScript = require("./a.css");
      ${shapeOf}
      let inTry;
      try {
        inTry = require("./a.css");
      } catch (e) {
        inTry = String(e);
      }
      const inArrow = () => require("./a.css");
      // The printed value needs its parentheses in these places. The page does not load without them.
      require("./a.css").written = true;
      function neverCalled() {
        new (require("./a.css"))();
        new (import("./a.css"))();
        require("./a.css")\`tag\`;
      }
      (async () => {
        console.log({
          inCommonJS: shape(inCommonJS),
          inPackage,
          inTypeScript: shape(inTypeScript),
          inTry: shape(inTry),
          inArrow: shape(inArrow()),
          afterAwait: shape((await import("./a.css")).default),
        });
      })();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage({
      inCommonJS: "object {}",
      inPackage: true,
      inTypeScript: "object {}",
      inTry: "object {}",
      inArrow: "object {}",
      afterAwait: "object {}",
    });
    await c.style(".a").color.expect.toBe("red");
    await c.style(".pkg").color.expect.toBe("#00f");
  },
});
// A CSS module exports its class names. It does not get the value of a plain stylesheet.
const readsCssModule = (pass: string) => `
  ${shapeOf}
  let required;
  try {
    required = shape(require("./card.module.css"));
  } catch (e) {
    required = "threw";
  }
  import("./card.module.css")
    .then(shape, () => "rejected")
    .then(imported =>
      console.log({
        pass: ${JSON.stringify(pass)},
        requiredIsEmptyModule: required === "object {}",
        importedIsEmptyModule: imported === 'object {"default":{}}',
      }),
    );
  import.meta.hot.accept();
`;
devTest("require() and import() of a CSS module do not give an empty module", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "card.module.css": `.card { color: green; }`,
    "app.ts": readsCssModule("bundled together"),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage({ pass: "bundled together", requiredIsEmptyModule: false, importedIsEmptyModule: false });
    await dev.write("app.ts", readsCssModule("importer edited"));
    await c.expectMessage({ pass: "importer edited", requiredIsEmptyModule: false, importedIsEmptyModule: false });
  },
});
// A record that a plugin answers keeps its source index under the dev server, as the record of a stylesheet does.
// A plugin can answer with a module for a path that looks like a stylesheet, or with a stylesheet for any specifier.
devTest("require() and import() of what a plugin resolves or loads", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      import * as path from "path";
      const files = { "virtual:tokens": "tokens.ts", "virtual:sheet": "sheet.css", "virtual:card": "card.module.css" };
      export default {
        name: "modules",
        setup(build) {
          build.onLoad({ filter: /theme\\.css$/ }, () => ({ contents: "export const color = 'red';", loader: "js" }));
          build.onResolve({ filter: /^virtual:/ }, args => ({ path: path.join(import.meta.dirname, files[args.path]) }));
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "theme.css": `.theme { color: red; }`,
    "tokens.ts": `export const size = 4;`,
    "sheet.css": `.sheet { color: red; }`,
    "card.module.css": `.card { color: green; }`,
    "app.ts": `
      ${shapeOf}
      const read = (load: () => unknown) => {
        try {
          return shape(load());
        } catch {
          return "threw";
        }
      };
      const modules = [require("./theme.css").color, require("virtual:tokens").size];
      const stylesheet = read(() => require("virtual:sheet"));
      const cssModule = read(() => require("virtual:card"));
      Promise.all([import("./theme.css"), import("virtual:tokens")]).then(([theme, tokens]) =>
        console.log({
          modules,
          imported: [theme.color, tokens.size],
          stylesheet,
          cssModuleIsEmptyModule: cssModule === "object {}",
        }),
      );
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage({
      modules: ["red", 4],
      imported: ["red", 4],
      stylesheet: "object {}",
      cssModuleIsEmptyModule: false,
    });
    await c.style(".sheet").color.expect.toBe("red");
  },
});
devTest("require() and import() of a stylesheet in a server module", {
  framework: minimalFramework,
  files: {
    "a.css": `.a { color: red; }`,
    "routes/index.ts": `
      export default async function (req, meta) {
        ${shapeOf}
        const required = shape(require("../a.css"));
        const pending = import("../a.css");
        const promise = pending instanceof Promise;
        return Response.json({ required, promise, imported: shape(await pending) });
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({ required: "object {}", promise: true, imported: 'object {"default":{}}' });
  },
});
// The server graph takes a stylesheet from the cache of the dev server only after its first 512 files.
const serverRouteWithModules = (body: string) => `
  ${modulesPastFirstBitsetStep.map(name => `import "../modules/${name}";`).join("\n  ")}
  import "../a.css";
  export default async function (req, meta) {
    ${body}
  }
`;
devTest("require() and import() of a stylesheet from the cache in a server module", {
  framework: minimalFramework,
  files: {
    "a.css": `.a { color: red; }`,
    ...Object.fromEntries(modulesPastFirstBitsetStep.map(name => [`modules/${name}.ts`, `export default "${name}";`])),
    "routes/index.ts": serverRouteWithModules(`return Response.json({ pass: "stylesheet imported" });`),
  },
  async test(dev) {
    await dev.fetch("/").equals({ pass: "stylesheet imported" });
    await dev.write(
      "routes/index.ts",
      serverRouteWithModules(`
        ${shapeOf}
        const required = shape(require("../a.css"));
        const imported = await import("../a.css").then(shape, String);
        return Response.json({ pass: "importer edited", required, imported });
      `),
    );
    await dev.fetch("/").equals({ pass: "importer edited", required: "object {}", imported: 'object {"default":{}}' });
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
