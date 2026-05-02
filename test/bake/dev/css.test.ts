// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import assert from "node:assert";
import { devTest, emptyHtmlFile, imageFixtures } from "../bake-harness";

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

// Regression: multiple <link rel="stylesheet"> tags must be served in the
// same order they appear in the source HTML. The CSS cascade's source-order
// tiebreak (CSS Cascade Level 4 § 6.4.6) decides which of two equally
// specific declarations wins; if the dev server emits the link tags in the
// wrong order, the cascade resolves backward and the wrong rule wins.
devTest("multiple stylesheet links preserve source order", {
  files: {
    "a.css": `
      .target { color: red; }
    `,
    "b.css": `
      .target { color: blue; }
    `,
    "index.html": emptyHtmlFile({
      styles: ["a.css", "b.css"],
      body: `<div class="target">hello</div>`,
    }),
  },
  async test(dev) {
    await using c = await dev.client("/");
    // a.css declares red; b.css declares blue. Both have specificity
    // (0,1,0) and are unlayered. Source-order tiebreak: b.css wins.
    await c.style(".target").color.expect.toBe("#00f");
  },
});

devTest("multiple stylesheet links preserve source order inside @layer", {
  files: {
    "a.css": `
      @layer test {
        .target { color: red; }
      }
    `,
    "b.css": `
      @layer test {
        .target { color: blue; }
      }
    `,
    "index.html": emptyHtmlFile({
      styles: ["a.css", "b.css"],
      body: `<div class="target">hello</div>`,
    }),
  },
  async test(dev) {
    await using c = await dev.client("/");
    // Both rules sit inside the same @layer; source-order tiebreak still
    // applies, so b.css wins.
    await c.style(".target").color.expect.toBe("#00f");
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
