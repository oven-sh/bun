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

// todo: add build support for this
test.each(["runtime" /*"build"*/])("many static routes with custom headers/status (%s)", async runtime => {
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
        "X-Test": "test-value",
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

  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  if (runtime === "runtime") {
    proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
    });
  } else {
    const buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "server.ts", "--outdir", "dist", "--target", "bun", "--splitting"],
      env: bunEnv,
      cwd: dir,
    });
    await buildProc.exited;
    buildProc.kill();

    proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: dir + "/dist",
      stdout: "pipe",
    });
  }

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

test("HTMLBundle in Response error conditions", async () => {
  const dir = tempDirWithFiles("html-response-errors", {
    "index.html": /*html*/ `<\!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
</head>
<body>
  <h1>Error Test</h1>
</body>
</html>`,
    "test.ts": `
import html from "./index.html";
const response = new Response(html);

const tests = [
  () => response.text(),
  () => response.blob(),
  () => response.json(),
  () => response.arrayBuffer(),
  () => response.formData(),
  () => Bun.write("output.html", response.body),
  () => Bun.spawn({
    cmd: ["echo", "test"],
    stdin: response.body
  })
];

for (let i = 0; i < tests.length; i++) {
  try {
    const result = await tests[i]();
    console.log(\`FAIL: Test \${i} should have thrown\`);
  } catch (e) {
    if (e.toString().includes("HTMLBundle")) {
      console.log(\`PASS: Test \${i} threw as expected\`);
    } else {
      console.log(\`HALF PASS: Test \${i} should have thrown better error message\`);
    }
  }
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
  });

  expect(await proc.stdout.text()).toMatchInlineSnapshot(`
    "PASS: Test 0 threw as expected
    PASS: Test 1 threw as expected
    PASS: Test 2 threw as expected
    PASS: Test 3 threw as expected
    PASS: Test 4 threw as expected
    PASS: Test 5 threw as expected
    PASS: Test 6 threw as expected
    "
  `);
});
