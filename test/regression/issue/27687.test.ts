import { describe, expect, test } from "bun:test";

describe("issue #27687 - virtual HTML entrypoint with absolute script src", () => {
  test("resolves virtual script referenced via absolute path from virtual HTML", async () => {
    const result = await Bun.build({
      entrypoints: ["/virtual/index.html"],
      target: "browser",
      format: "esm",
      minify: false,
      files: {
        "/virtual/index.html": `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body>
  <div id="root"></div>
  <script type="module" src="/virtual/_hydrate.tsx"></script>
</body>
</html>`,
        "/virtual/_hydrate.tsx": `console.log("Hydration entry loaded");`,
      },
    });

    if (!result.success) {
      console.error(result.logs);
    }

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(2);

    const htmlOutput = result.outputs.find(o => o.type?.startsWith("text/html"));
    expect(htmlOutput).toBeDefined();

    const jsOutput = result.outputs.find(o => o.type?.startsWith("text/javascript"));
    expect(jsOutput).toBeDefined();

    const jsContent = await jsOutput!.text();
    expect(jsContent).toContain("Hydration entry loaded");
  });

  test("resolves virtual script with absolute path from different virtual directory", async () => {
    const result = await Bun.build({
      entrypoints: ["/app/index.html"],
      target: "browser",
      format: "esm",
      minify: false,
      files: {
        "/app/index.html": `
<!DOCTYPE html>
<html>
<body>
  <script type="module" src="/shared/utils.js"></script>
</body>
</html>`,
        "/shared/utils.js": `export const msg = "cross-directory import works";
console.log(msg);`,
      },
    });

    if (!result.success) {
      console.error(result.logs);
    }

    expect(result.success).toBe(true);

    const jsOutput = result.outputs.find(o => o.type?.startsWith("text/javascript"));
    expect(jsOutput).toBeDefined();

    const jsContent = await jsOutput!.text();
    expect(jsContent).toContain("cross-directory import works");
  });

  test("resolves virtual script with root-level absolute path from virtual HTML", async () => {
    const result = await Bun.build({
      entrypoints: ["/index.html"],
      target: "browser",
      format: "esm",
      minify: false,
      files: {
        "/index.html": `
<!DOCTYPE html>
<html>
<body>
  <script type="module" src="/app.js"></script>
</body>
</html>`,
        "/app.js": `console.log("root level script");`,
      },
    });

    if (!result.success) {
      console.error(result.logs);
    }

    expect(result.success).toBe(true);

    const jsOutput = result.outputs.find(o => o.type?.startsWith("text/javascript"));
    expect(jsOutput).toBeDefined();

    const jsContent = await jsOutput!.text();
    expect(jsContent).toContain("root level script");
  });
});
