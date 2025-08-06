import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("static route with new Response(html) and custom headers/status", async () => {
  const dir = tempDirWithFiles("html-response-static", {
    "index.html": /*html*/ `<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <script type="module" src="./app.ts"></script>
</head>
<body>
  <h1>Hello from HTMLBundle</h1>
</body>
</html>`,
    "app.ts": /*ts*/ `console.log("App loaded");`,
    "server.ts": /*ts*/ `
import html from "./index.html";

const server = Bun.serve({
  port: 0,
  development: false,
  routes: {
    "/": new Response(html, {
      status: 201,
      headers: {
        "X-Custom": "custom-value",
        "X-Test": "test-value"
      }
    })
  }
});

console.log(server.port);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
  });

  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  const port = parseInt(new TextDecoder().decode(value).trim());

  const response = await fetch(`http://localhost:${port}/`);

  expect(response.status).toBe(201);
  expect(response.headers.get("X-Custom")).toBe("custom-value");
  expect(response.headers.get("X-Test")).toBe("test-value");
  expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

  const text = await response.text();
  expect(text).toContain("Test Page");
  expect(text).toContain("Hello from HTMLBundle");
  expect(text).toMatch(/src="[^"]+\.js"/);

  proc.kill();
});
