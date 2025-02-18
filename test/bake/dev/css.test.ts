// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, imageFixtures, reactRefreshStub } from "../dev-server-harness";
import assert from "node:assert";

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
    await using client = await dev.client("/");
    await client.style("body").color.expect.toBe("red");
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
    await client.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: red;
          background-color: blue;
        }
      `,
    );
    await client.style("body").backgroundColor.expect.toBe("#00f");
    await dev.write("styles.css", ` `, { dedent: false });
    await client.style("body").notFound();
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
    await using client = await dev.client("/", {
      errors: ["styles.css:3:3: error: Unexpected end of input"],
    });
    // hard reload to dismiss the error overlay
    await client.expectReload(async () => {
      await dev.write(
        "styles.css",
        `
          body {
            color: red;
          }
        `,
      );
    });
    await client.style("body").color.expect.toBe("red");
    await dev.write(
      "styles.css",
      `
        body {
          color: blue;
        }
      `,
    );
    await client.style("body").color.expect.toBe("#00f");
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
    ...reactRefreshStub,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts", "react-refresh/runtime"],
      body: `hello world`,
    }),
    "index.ts": `
      // import "./styles.css";
      export default function () {
        return "hello world";
      }
    `,
    "styles.css": `
      body {
        color: red;
      }
    `,
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.style("body").notFound();
    await dev.patch("index.ts", { find: "// import", replace: "import" });
    await client.style("body").color.expect.toBe("red");
    await dev.patch("index.ts", { find: "import", replace: "// import" });
    await client.style("body").notFound();
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
    await using client = await dev.client("/");
    let backgroundImage = await client.style("body").backgroundImage;
    assert(backgroundImage);
    await dev.fetch(extractCssUrl(backgroundImage)).expectFile(imageFixtures.bun);
    await dev.write("bun.png", imageFixtures.bun2);
    backgroundImage = await client.style("body").backgroundImage;
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
    await using client = await dev.client("/");
    await client.style(".colored").color.expect.toBe("#00f");

    // Remove the import
    await dev.write(
      "main.css",
      `
        /* @import "./colors.css"; */
        .main { background: white; }
      `,
    );
    await client.style(".colored").notFound();

    // A change to 'colors.css' should not trigger a rebuild of 'main.css', nor notify any clients.
    await client.expectNoWebSocketActivity(async () => {
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
    await client.style(".colored").notFound();

    // Re-add the import
    await dev.write(
      "main.css",
      `
        @import "./colors.css";
        .main { background: white; }
      `,
    );
    await client.style(".colored").color.expect.toBe("#00f");
    await client.style(".main").backgroundColor.expect.toBe("#fff");
  },
});

function extractCssUrl(backgroundImage: string): string {
  const url = backgroundImage.match(/url\((['"])(.*?)\1\)/);
  if (!url) {
    throw new Error("No url found in background-image: " + backgroundImage);
  }
  return url[2];
}
