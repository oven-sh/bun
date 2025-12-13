import { devTest } from "../bake-harness";

const emptyHtmlFile = (options: { scripts: string[] }) => {
  return `
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  ${options.scripts.map(s => `<script type="module" src="./${s}"></script>`).join("\n  ")}
</body>
</html>
  `.trim();
};

// Parametrize tests with clientOverlay option
for (const clientOverlay of [true, false, undefined] as const) {
  const suffix =
    clientOverlay === undefined
      ? " (default overlay enabled)"
      : clientOverlay
        ? " (overlay enabled)"
        : " (overlay disabled)";

  devTest(`build error shows overlay${suffix}`, {
    bunfig:
      clientOverlay === undefined
        ? undefined
        : {
            dev: {
              clientOverlay,
            },
          },
    files: {
      "index.html": emptyHtmlFile({
        scripts: ["index.ts"],
      }),
      "index.ts": `
        import { abc } from './second';
        console.log('value: ' + abc);
      `,
    },
    async test(dev) {
      await using c = await dev.client("/", {
        // If clientOverlay is false, we should NOT expect errors in the overlay
        errors: clientOverlay === false ? [] : [`index.ts:1:21: error: Could not resolve: "./second"`],
      });

      await c.expectReload(async () => {
        await dev.write("second.ts", `export const abc = "456";`);
      });

      await c.expectMessage("value: 456");
    },
  });

  devTest(`runtime error shows overlay${suffix}`, {
    bunfig:
      clientOverlay === undefined
        ? undefined
        : {
            dev: {
              clientOverlay,
            },
          },
    files: {
      "index.html": emptyHtmlFile({
        scripts: ["index.ts"],
      }),
      "index.ts": `
        import.meta.hot.accept();
        console.log("loaded");
        document.getElementById("btn")?.addEventListener("click", () => {
          throw new Error("Runtime error!");
        });
      `,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("loaded");

      // Simulate clicking a button that throws an error
      await c.js`
        const btn = document.createElement("button");
        btn.id = "btn";
        document.body.appendChild(btn);
        btn.click();
      `;

      // If clientOverlay is false, the error modal should NOT be visible
      if (clientOverlay === false) {
        const hasVisibleModal = await c.js`document.querySelector("bun-hmr")?.style.display === "block"`;
        if (hasVisibleModal) {
          throw new Error("Error overlay should not be visible when clientOverlay is false");
        }
      } else {
        // Otherwise, verify the overlay is shown (default behavior)
        await c.expectErrorOverlay(["Runtime error!"]);
      }
    },
  });

  devTest(`CSS build error shows overlay${suffix}`, {
    bunfig:
      clientOverlay === undefined
        ? undefined
        : {
            dev: {
              clientOverlay,
            },
          },
    files: {
      "index.html": `
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div class="test">Test</div>
</body>
</html>
      `.trim(),
      "styles.css": `
.test {
  color: red;
  /* syntax error
}
      `.trim(),
    },
    async test(dev) {
      await using c = await dev.client("/", {
        errors: clientOverlay === false ? [] : ["styles.css:4:1: error: Unexpected end of input"],
      });

      // Fix the syntax error
      await c.expectReload(async () => {
        await dev.write(
          "styles.css",
          `
.test {
  color: red;
}
        `.trim(),
        );
      });
    },
  });
}
