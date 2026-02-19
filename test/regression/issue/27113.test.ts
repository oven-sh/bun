import { expect, test } from "bun:test";
import { tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27113
// Standalone HTML: <head> script must execute before inline <body> scripts
test("standalone HTML head script executes before inline body scripts", async () => {
  using dir = tempDir("issue-27113", {
    "setup.js": `window.greeting = "Hello from setup.js";`,
    "index.html": `<!doctype html>
<html>
  <head>
    <script src="./setup.js"></script>
  </head>
  <body>
    <pre id="out"></pre>
    <script>
      document.getElementById("out").textContent =
        "greeting: " + window.greeting;
    </script>
  </body>
</html>`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/index.html`],
    compile: true,
    target: "browser",
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const html = await result.outputs[0].text();

  // The bundled script should be in <head>, not before </body>
  const headEnd = html.indexOf("</head>");
  const bodyStart = html.indexOf("<body>");
  const scriptStart = html.indexOf("<script>");
  expect(headEnd).toBeGreaterThan(-1);
  expect(bodyStart).toBeGreaterThan(-1);
  expect(scriptStart).toBeGreaterThan(-1);

  // The inlined script containing setup.js must appear BEFORE </head>
  expect(scriptStart).toBeLessThan(headEnd);

  // The script must NOT use type="module" (which would defer execution)
  expect(html).not.toContain('<script type="module">');

  // The setup code should be present
  expect(html).toContain('window.greeting = "Hello from setup.js"');
});
