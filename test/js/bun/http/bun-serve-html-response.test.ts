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

test("many static routes with custom headers/status", async () => {
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
    "hello.html": /*html*/ `<!DOCTYPE html>
<html>
<head>
  <title>Hello Page</title>
</head>
<body>
  <h1>Hello from HTMLBundle</h1>
</body>
</html>`,
    "app.ts": /*ts*/ `console.log("App loaded");`,
    "server.ts": /*ts*/ `
import html from "./index.html";
import hello from "./hello.html";

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
    }),
    "/home": new Response(html),
    "/haha": new Response(html, {status: 400}),
    "/index.html": html,
    "/tea": {
      GET: new Response(html, {status: 418}),
      POST: () => new Response("Teapot!!!"),
    },
    "/hello": new Response(hello),
    "/*": new Response(html, {
      status: 404,
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

  {
    const response = await fetch(`http://localhost:${port}/`);

    expect(response.status).toBe(201);
    expect(response.headers.get("X-Custom")).toBe("custom-value");
    expect(response.headers.get("X-Test")).toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

    const text = await response.text();
    expect(text).toContain("Test Page");
    expect(text).toContain("Hello from HTMLBundle");
    expect(text).toMatch(/src="[^"]+\.js"/);
  }

  {
    const response = await fetch(`http://localhost:${port}/home`);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Custom")).not.toBe("custom-value");
    expect(response.headers.get("X-Test")).not.toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

    const text = await response.text();
    expect(text).toContain("Test Page");
    expect(text).toContain("Hello from HTMLBundle");
    expect(text).toMatch(/src="[^"]+\.js"/);
  }

  {
    const response = await fetch(`http://localhost:${port}/index.html`);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Custom")).not.toBe("custom-value");
    expect(response.headers.get("X-Test")).not.toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

    const text = await response.text();
    expect(text).toContain("Test Page");
    expect(text).toContain("Hello from HTMLBundle");
    expect(text).toMatch(/src="[^"]+\.js"/);
  }

  {
    const response = await fetch(`http://localhost:${port}/haha`);
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Custom")).not.toBe("custom-value");
    expect(response.headers.get("X-Test")).not.toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

    const text = await response.text();
    expect(text).toContain("Test Page");
    expect(text).toContain("Hello from HTMLBundle");
    expect(text).toMatch(/src="[^"]+\.js"/);
  }

  {
    const response = await fetch(`http://localhost:${port}/tea`, {
      method: "GET",
    });

    expect(response.status).toBe(418);
    expect(response.headers.get("X-Custom")).not.toBe("custom-value");
    expect(response.headers.get("X-Test")).not.toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

    const text = await response.text();
    expect(text).toContain("Test Page");
    expect(text).toContain("Hello from HTMLBundle");
    expect(text).toMatch(/src="[^"]+\.js"/);
  }

  {
    const response = await fetch(`http://localhost:${port}/tea`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Custom")).not.toBe("custom-value");
    expect(response.headers.get("X-Test")).not.toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");

    const text = await response.text();
    expect(text).toBe("Teapot!!!");
  }

  {
    const response = await fetch(`http://localhost:${port}/hello`);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Custom")).not.toBe("custom-value");
    expect(response.headers.get("X-Test")).not.toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

    const text = await response.text();
    expect(text).toContain("Hello Page");
    expect(text).toContain("Hello from HTMLBundle");
    expect(text).toMatch(/src="[^"]+\.js"/);
  }

  {
    const response = await fetch(`http://localhost:${port}/not-found`);
    expect(response.status).toBe(404);

    expect(response.headers.get("X-Custom")).not.toBe("custom-value");
    expect(response.headers.get("X-Test")).not.toBe("test-value");
    expect(response.headers.get("Content-Type")).toBe("text/html;charset=utf-8");

    const text = await response.text();
    expect(text).toContain("Test Page");
    expect(text).toContain("Hello from HTMLBundle");
    expect(text).toMatch(/src="[^"]+\.js"/);
  }

  proc.kill();
});
