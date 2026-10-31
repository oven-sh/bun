// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import assert from "node:assert";
import { Client, Dev, devTest, emptyHtmlFile, imageFixtures, WAIT_MULTIPLIER } from "../bake-harness";

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

/**
 * Puts counters on the page:
 * - `css.requests`: its requests for the text of a stylesheet.
 * - `css.answered`: how many of them the server has answered.
 * - `css.texts`: the text that each stylesheet got, in order.
 * - `css.updates`: the hot updates with code that reached the HMR runtime.
 * `css.until(condition)` waits in the page until a counter makes `condition` true.
 * With `hold`, the answer to request `i` stays away from the runtime until `css.release[i]()`.
 * `css.fail` is how many of the next answers are replaced with a 404.
 */
async function watchStylesheets(c: Client, { hold = false } = {}) {
  await c.js`
    const { fetch } = window;
    const { replace } = CSSStyleSheet.prototype;
    const hmr = Symbol.for("bun:hmr");
    const takeUpdate = globalThis[hmr];
    const waiting = [];
    const changed = () => {
      for (const check of waiting.splice(0)) check();
    };
    globalThis.css = {
      requests: 0,
      answered: 0,
      texts: [],
      updates: 0,
      release: [],
      fail: 0,
      until: condition =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The page did not reach: " + condition)), ${2000 * WAIT_MULTIPLIER});
          const check = () => {
            if (!condition()) return waiting.push(check);
            clearTimeout(timer);
            resolve();
          };
          check();
        }),
    };
    window.fetch = async (url, init) => {
      if (!String(url).includes("/_bun/asset/")) return fetch(url, init);
      const held = new Promise(resolve => css.release.push(resolve));
      css.requests++;
      changed();
      const response = css.fail-- > 0 ? new Response("", { status: 404 }) : await fetch(url, init);
      const text = await response.text();
      css.answered++;
      changed();
      if (${hold}) await held;
      return new Response(text, { status: response.status });
    };
    CSSStyleSheet.prototype.replace = function (text) {
      css.texts.push(text);
      changed();
      return replace.call(this, text);
    };
    globalThis[hmr] = (...args) => {
      css.updates++;
      changed();
      return takeUpdate(...args);
    };
  `;
}

/**
 * `dev.write` returns when every page has applied the update. A page that waits for the text of
 * a stylesheet has not, so `dev.write` does not wait for `c` while `cb` runs.
 */
async function whileHeld(dev: Dev, c: Client, cb: () => Promise<void>) {
  dev.connectedClients.delete(c);
  try {
    await cb();
  } finally {
    dev.connectedClients.add(c);
  }
}

// A page that drops the imports of its stylesheets and loads again has the text of neither, and
// the dev server does not bundle a stylesheet again when its import comes back.
const pageWithoutItsStylesheets = {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1>hello</h1>" }),
    "index.ts": `import "./m.css"; import "./n.css"; console.log("1"); import.meta.hot.accept();`,
    "m.css": `h1 { color: red; }`,
    "n.css": `h1 { color: green; }`,
    "other.ts": `export {};`,
  },
  async open(dev: Dev, options: { hold?: boolean } = {}) {
    const c = await dev.client("/");
    await c.expectMessage("1");
    await dev.write("index.ts", `console.log("2"); import.meta.hot.accept();`);
    await c.expectMessage("2");
    await c.hardReload();
    await c.expectMessage("2");
    await c.style("h1").notFound();
    await watchStylesheets(c, options);
    return c;
  },
};

devTest("a stylesheet that a hot update lists without its text is loaded before the update runs", {
  files: {
    "a.html": emptyHtmlFile({ scripts: ["a.ts"], body: "<h1>hello</h1>" }),
    "b.html": emptyHtmlFile({ scripts: ["b.ts"] }),
    "a.ts": `console.log("a 1"); import.meta.hot.accept();`,
    "b.ts": `import "./m.ts"; console.log("b 1"); import.meta.hot.accept();`,
    "m.ts": `import "./m.css"; console.log("m 1");`,
    "m.css": `h1 { color: red; }`,
  },
  async test(dev) {
    await using b = await dev.client("/b");
    await b.expectMessage("m 1", "b 1");
    await using a = await dev.client("/a");
    await a.expectMessage("a 1");
    // Tab a gets the module from this update, so that below it lacks only the stylesheet.
    await dev.patch("m.ts", { find: "m 1", replace: "m 2" });
    await b.expectMessage("m 2", "b 1");
    await a.expectMessage();
    await watchStylesheets(a);
    await watchStylesheets(b);
    // The graph holds m.ts and m.css, so this bundle prints neither. The update lists m.css for
    // /a and has no text for it.
    await dev.write(
      "a.ts",
      `import "./m.ts"; console.log("a 2 with " + document.adoptedStyleSheets.length + " stylesheet"); import.meta.hot.accept();`,
    );
    await a.expectMessage("m 2", "a 2 with 1 stylesheet");
    await a.style("h1").color.expect.toBe("red");
    expect(await a.js`css.requests`).toBe(1);
    // Tab b has the stylesheet from its link tag.
    expect(await b.js`[css.requests, document.adoptedStyleSheets.length]`).toEqual([0, 0]);
  },
});
devTest("a stylesheet import that is restored after the page loaded without it is applied", {
  files: pageWithoutItsStylesheets.files,
  async test(dev) {
    await using c = await pageWithoutItsStylesheets.open(dev);
    await dev.write("index.ts", `import "./m.css"; console.log("3"); import.meta.hot.accept();`);
    await c.expectMessage("3");
    await c.style("h1").color.expect.toBe("red");
    // The page has the text from now on.
    await dev.write("index.ts", `console.log("4"); import.meta.hot.accept();`);
    await c.expectMessage("4");
    await c.style("h1").notFound();
    await dev.write("index.ts", `import "./m.css"; console.log("5"); import.meta.hot.accept();`);
    await c.expectMessage("5");
    await c.style("h1").color.expect.toBe("red");
    await dev.write("m.css", `h1 { color: blue; }`);
    await c.style("h1").color.expect.toBe("#00f");
    expect(await c.js`css.requests`).toBe(1);
  },
});
devTest("a stylesheet that a page dropped stays off when the stylesheet is edited", {
  files: {
    "a.html": emptyHtmlFile({ scripts: ["a.ts"], body: "<h1>hello</h1>" }),
    "b.html": emptyHtmlFile({ scripts: ["b.ts"], body: "<h1>hello</h1>" }),
    "a.ts": `import "./m.css"; console.log("a 1"); import.meta.hot.accept();`,
    "b.ts": `import "./m.css"; console.log("b 1"); import.meta.hot.accept();`,
    "m.css": `h1 { color: red; }`,
  },
  async test(dev) {
    await using b = await dev.client("/b");
    await b.expectMessage("b 1");
    await using a = await dev.client("/a");
    await a.expectMessage("a 1");
    await a.style("h1").color.expect.toBe("red");
    await watchStylesheets(a);
    await dev.write("a.ts", `console.log("a 2"); import.meta.hot.accept();`);
    await a.expectMessage("a 2");
    await a.style("h1").notFound();
    // The text goes to every page.
    await dev.write("m.css", `h1 { color: blue; }`);
    await b.style("h1").color.expect.toBe("#00f");
    await a.style("h1").notFound();
    await dev.write("a.ts", `import "./m.css"; console.log("a 3"); import.meta.hot.accept();`);
    await a.expectMessage("a 3");
    await a.style("h1").color.expect.toBe("#00f");
    // Tab a had the text all the time: first from its link tag, then from the update.
    expect(await a.js`css.requests`).toBe(0);
  },
});
devTest("a stylesheet that a page drops while it requests the text stays off", {
  files: pageWithoutItsStylesheets.files,
  async test(dev) {
    await using c = await pageWithoutItsStylesheets.open(dev, { hold: true });
    await whileHeld(dev, c, async () => {
      await dev.write("index.ts", `import "./m.css"; console.log("3"); import.meta.hot.accept();`);
      await c.js`await css.until(() => css.answered === 1)`;
      await dev.write("index.ts", `console.log("4"); import.meta.hot.accept();`);
      await c.js`await css.until(() => css.updates === 2)`;
      await c.js`css.release[0]()`;
      // Both updates waited for the text.
      await c.expectMessage("3", "4");
    });
    expect(await c.js`css.texts`).toEqual([expect.stringContaining("color: red")]);
    await c.style("h1").notFound();
    await dev.write("index.ts", `import "./m.css"; console.log("5"); import.meta.hot.accept();`);
    await c.expectMessage("5");
    await c.style("h1").color.expect.toBe("red");
    expect(await c.js`css.requests`).toBe(1);
  },
});
devTest("a stylesheet that is edited while a page requests its text keeps the newer text", {
  files: pageWithoutItsStylesheets.files,
  async test(dev) {
    await using c = await pageWithoutItsStylesheets.open(dev, { hold: true });
    await whileHeld(dev, c, async () => {
      await dev.write("index.ts", `import "./m.css"; console.log("3"); import.meta.hot.accept();`);
      // The answer has the red text.
      await c.js`await css.until(() => css.answered === 1)`;
      await dev.write("m.css", `h1 { color: blue; }`);
      await c.js`await css.until(() => css.texts.length === 1)`;
      await c.js`css.release[0]()`;
      await c.expectMessage("3");
    });
    expect(await c.js`css.texts`).toEqual([expect.stringContaining("color: #00f")]);
    await c.style("h1").color.expect.toBe("#00f");
  },
});
devTest("a page requests the text of a stylesheet again after a request failed", {
  files: pageWithoutItsStylesheets.files,
  async test(dev) {
    await using c = await pageWithoutItsStylesheets.open(dev);
    await c.js`css.fail = 1`;
    await dev.write("index.ts", `import "./m.css"; console.log("3"); import.meta.hot.accept();`);
    await c.expectMessage("3");
    await c.style("h1").notFound();
    // The next update that lists the stylesheets of the page.
    await dev.write("index.ts", `import "./m.css"; import "./other.ts"; console.log("4"); import.meta.hot.accept();`);
    await c.expectMessage("4");
    await c.style("h1").color.expect.toBe("red");
    expect(await c.js`css.requests`).toBe(2);
  },
});
devTest("stylesheets that a page requests are applied in the order of a page load", {
  files: pageWithoutItsStylesheets.files,
  async test(dev) {
    await using c = await pageWithoutItsStylesheets.open(dev, { hold: true });
    await whileHeld(dev, c, async () => {
      await dev.write("index.ts", `import "./m.css"; import "./n.css"; console.log("3"); import.meta.hot.accept();`);
      await c.js`await css.until(() => css.answered === 2)`;
      // The answer to the first request comes last.
      await c.js`for (const i of [1, 0]) css.release[i]();`;
      await c.expectMessage("3");
    });
    const html = await dev.fetch("/").text();
    const linked = Array.from(html.matchAll(/\/_bun\/asset\/\w+\.css/g), match => dev.fetch(match[0]).text());
    expect(await c.js`css.texts`).toEqual(await Promise.all(linked));
  },
});
devTest("a page whose html has no </head> takes stylesheet updates", {
  files: {
    "index.html": `
      <h1>hello</h1>
      <script type="module" src="./index.ts"></script>
    `,
    "index.ts": `import "./m.css"; console.log("1"); import.meta.hot.accept();`,
    "m.css": `h1 { color: red; }`,
    "other.ts": `export {};`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("1");
    // The dev server wrote the link tag into the body.
    expect(await c.js`document.querySelector("link[rel=stylesheet]").parentNode.tagName`).toBe("BODY");
    await watchStylesheets(c);
    // This update lists the stylesheets of the page. The page has them all.
    await dev.write("index.ts", `import "./m.css"; import "./other.ts"; console.log("2"); import.meta.hot.accept();`);
    await c.expectMessage("2");
    expect(await c.js`[css.requests, document.adoptedStyleSheets.length]`).toEqual([0, 0]);
    await dev.write("m.css", `h1 { color: blue; }`);
    await c.style("h1").color.expect.toBe("#00f");
  },
});
devTest("a stylesheet follows the link tags that a framework removes and appends", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1>hello</h1>" }),
    "index.ts": `import "./m.css"; console.log("1"); import.meta.hot.accept();`,
    "m.css": `h1 { color: red; }`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("1");
    await c.js`
      const { href } = document.querySelector("link[rel=stylesheet]");
      // The HMR runtime learns of a change to <head> in a later task.
      globalThis.seen = () => new Promise(resolve => setTimeout(resolve));
      // Appends a link tag for the stylesheet of the page and waits until it has loaded.
      globalThis.appendLink = () =>
        new Promise((resolve, reject) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.onload = () => resolve(seen());
          link.onerror = reject;
          link.href = href;
          document.head.insertBefore(link, null);
        });
    `;
    await c.js`
      document.querySelector("link[rel=stylesheet]").remove();
      await seen();
      await appendLink();
    `;
    await c.style("h1").color.expect.toBe("red");
    await dev.write("index.ts", `console.log("2"); import.meta.hot.accept();`);
    await c.expectMessage("2");
    await c.style("h1").notFound();
    await dev.write("index.ts", `import "./m.css"; console.log("3"); import.meta.hot.accept();`);
    await c.expectMessage("3");
    await c.style("h1").color.expect.toBe("red");
    // A framework appends its own link tag before it removes the one that the server rendered.
    await c.js`
      const rendered = document.querySelector("link[rel=stylesheet]");
      await appendLink();
      rendered.remove();
      await seen();
    `;
    await c.style("h1").color.expect.toBe("red");
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
