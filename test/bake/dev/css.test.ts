// CSS tests concern bundling bugs with CSS files
import { expect } from "bun:test";
import assert from "node:assert";
import { type Dev, devTest, emptyHtmlFile, imageFixtures, minimalFramework } from "../bake-harness";

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
      expect((await dev.fetch("/")).status).toBe(500);
    }
    // Recovery is checked without a connected client: when a failed CSS root
    // recovers, the patch currently ships the HTML route as a JS module
    // without the route-reload flag, which trips a client-side debug assert
    // (tracked in https://github.com/oven-sh/bun/issues/31908).
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

// `meta.styles` is computed from the import graph on a route's first request
// and cached on the route bundle. Until the last part of this test nothing is
// subscribed to hot updates (only `dev.fetch` and the harness's watch
// synchronization socket talk to the server), which used to leave that cache
// in place forever.
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
    expect(await routeStyles(dev, "/")).toEqual(["one.css"]);
    expect(await routeStyles(dev, "/other")).toEqual([]);

    await dev.write("routes/index.ts", routeRespondingWithStyles("one.css", "two.css"));
    const withTwo = await routeStyles(dev, "/");
    expect(withTwo.toSorted()).toEqual(["one.css", "two.css"]);

    // The same two imports swapped: the route's edges in the graph stay the
    // same, only their order changes.
    await dev.write("routes/index.ts", routeRespondingWithStyles("two.css", "one.css"));
    expect(await routeStyles(dev, "/")).toEqual(withTwo.toReversed());

    await dev.write("routes/index.ts", routeRespondingWithStyles("two.css"));
    expect(await routeStyles(dev, "/")).toEqual(["two.css"]);

    // The layout's stylesheets belong to both routes, and both routes have a
    // cached list by now.
    await dev.write("routes/_layout.ts", cssImports("three.css"));
    expect((await routeStyles(dev, "/")).toSorted()).toEqual(["three.css", "two.css"]);
    expect(await routeStyles(dev, "/other")).toEqual(["three.css"]);

    // Now with a hot update subscriber looking at "/". Every rebuild publishes
    // one hot update to it.
    using hmr = await viewRouteOverHmr(dev, "/");
    await dev.write("routes/other.ts", `export default function (`);
    await hmr.nextHotUpdate();
    await dev.write("routes/index.ts", routeRespondingWithStyles("four.css"));
    // While another route has a bundling error, viewers are not told to reload
    // or restyle anything (they are shown the error instead). The styles the
    // server renders with are refreshed all the same.
    expect(await hmr.nextHotUpdate()).toEqual({ reloadedRoutes: [], routeCss: {} });
    expect((await routeStyles(dev, "/")).toSorted()).toEqual(["four.css", "three.css"]);

    await dev.write("routes/other.ts", routeRespondingWithStyles("one.css"));
    await hmr.nextHotUpdate();
    expect((await routeStyles(dev, "/other")).toSorted()).toEqual(["one.css", "three.css"]);

    // With the error gone, the viewer of "/" is told to reload it and which
    // stylesheets it has now, and those are the ones the server renders with.
    await dev.write("routes/index.ts", routeRespondingWithStyles());
    const update = await hmr.nextHotUpdate();
    const hrefs: string[] = await dev.fetch("/").json();
    expect(await stylesheetFileNames(dev, hrefs)).toEqual(["three.css"]);
    expect(update).toEqual({
      reloadedRoutes: [hmr.routeBundleIndex],
      routeCss: { [hmr.routeBundleIndex]: hrefs.map(href => href.match(/^\/_bun\/asset\/([0-9a-f]{16})\.css$/)![1]) },
    });
  },
});

/** Fetches a route written with `routeRespondingWithStyles` and resolves the stylesheets to file names. */
async function routeStyles(dev: Dev, route: string): Promise<string[]> {
  return stylesheetFileNames(dev, await dev.fetch(route).json());
}

/** Resolves served stylesheet urls to the file name in the comment each chunk starts with. */
function stylesheetFileNames(dev: Dev, hrefs: string[]): Promise<string[]> {
  return Promise.all(
    hrefs.map(async href => {
      const css = await dev.fetch(href).text();
      const header = css.match(/^\/\* (.*) \*\/\n/);
      if (!header) throw new Error(`${href} does not start with a file name comment:\n${css}`);
      return header[1];
    }),
  );
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

/**
 * Performs the handshake the HMR runtime performs in a browser: subscribes to
 * hot updates and errors, then tells the dev server which route is being
 * viewed. Resolves once the server has acknowledged the route.
 */
async function viewRouteOverHmr(dev: Dev, route: string) {
  const ws = new WebSocket(dev.baseUrl + "/_bun/hmr");
  ws.binaryType = "arraybuffer";
  const viewing = Promise.withResolvers<number>();
  const unreadHotUpdates: ArrayBuffer[] = [];
  let reader: PromiseWithResolvers<ArrayBuffer> | null = null;
  const fail = (reason: string) => {
    viewing.reject(new Error(reason));
    reader?.reject(new Error(reason));
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
