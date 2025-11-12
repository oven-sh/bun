// Regression test for https://github.com/oven-sh/bun/pull/24608
// Tests that CSS chunks mixed with JS chunks don't cause panics in IncrementalGraph
import { devTest, emptyHtmlFile } from "../bake-harness";

devTest("css and js chunks mixed in incremental graph", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      styles: ["styles.css"],
      body: `<div class="test">Hello World</div>`,
    }),
    "index.ts": `
      import "./styles.css";
      export default function () {
        return "hello world";
      }
      import.meta.hot.accept();
    `,
    "styles.css": `
      .test {
        color: red;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");

    // Verify initial load works with mixed CSS/JS chunks
    await c.style(".test").color.expect.toBe("red");

    // Hot reload CSS - this triggers IncrementalGraph to handle both CSS and JS chunks
    await dev.write(
      "styles.css",
      `
        .test {
          color: blue;
        }
      `,
    );
    await c.style(".test").color.expect.toBe("#00f");

    // Hot reload JS - ensure CSS chunks don't break JS bundle generation
    await dev.write(
      "index.ts",
      `
        import "./styles.css";
        export default function () {
          return "hello world updated";
        }
        import.meta.hot.accept();
      `,
    );

    // Verify both still work
    await c.style(".test").color.expect.toBe("#00f");
  },
});

devTest("multiple css imports with js creates mixed chunks", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      styles: ["first.css", "second.css"],
    }),
    "index.ts": `
      import "./first.css";
      import "./second.css";
      import "./third.css";
      import.meta.hot.accept();
    `,
    "first.css": `
      .first { color: red; }
    `,
    "second.css": `
      .second { color: blue; }
    `,
    "third.css": `
      .third { color: green; }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");

    // Verify all CSS is loaded
    await c.style(".first").color.expect.toBe("red");
    await c.style(".second").color.expect.toBe("#00f");
    await c.style(".third").color.expect.toBe("green");

    // Update one of the CSS files to trigger chunk handling
    await dev.write(
      "second.css",
      `
        .second { color: yellow; }
      `,
    );
    await c.style(".second").color.expect.toBe("#ff0");

    // Verify others are still working
    await c.style(".first").color.expect.toBe("red");
    await c.style(".third").color.expect.toBe("green");
  },
});

devTest("css import in nested js modules", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["main.ts"],
      body: `<div class="main">Main</div><div class="component">Component</div>`,
    }),
    "main.ts": `
      import "./main.css";
      import "./component.ts";
      export default function() { return "main"; }
      import.meta.hot.accept();
    `,
    "component.ts": `
      import "./component.css";
      import.meta.hot.accept();
    `,
    "main.css": `
      .main { color: red; }
    `,
    "component.css": `
      .component { color: blue; }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");

    // Verify CSS from both modules loads
    await c.style(".main").color.expect.toBe("red");
    await c.style(".component").color.expect.toBe("#00f");

    // Update component CSS to trigger IncrementalGraph update with mixed chunks
    await dev.write(
      "component.css",
      `
        .component { color: green; }
      `,
    );
    await c.style(".component").color.expect.toBe("green");
    await c.style(".main").color.expect.toBe("red");

    // Update component JS which imports CSS
    await dev.write(
      "component.ts",
      `
        import "./component.css";
        import.meta.hot.accept();
      `,
    );

    // Verify everything still works after JS update that has CSS imports
    await c.style(".component").color.expect.toBe("green");
    await c.style(".main").color.expect.toBe("red");
  },
});
