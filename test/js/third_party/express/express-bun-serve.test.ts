import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import express from "../../../../src/js/thirdparty/express-bun";

test("Express shim with bun.serve - basic GET route", async () => {
  using dir = tempDir("express-bun-test", {
    "server.ts": `
      import express from "../../../../src/js/thirdparty/express-bun";
      
      const app = express();
      
      app.get("/", (req, res) => {
        res.send("Hello World");
      });
      
      const server = Bun.serve({
        port: 0,
        fetch: app.fetch.bind(app),
      });
      
      console.log(server.url.href);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("http://");
});

test("Express shim with bun.serve - route with params", async () => {
  using dir = tempDir("express-bun-test-params", {
    "server.ts": `
      import express from "../../../../src/js/thirdparty/express-bun";
      
      const app = express();
      
      app.get("/users/:id", (req, res) => {
        res.json({ userId: req.params.id });
      });
      
      const server = Bun.serve({
        port: 0,
        fetch: app.fetch.bind(app),
      });
      
      const url = server.url.href;
      const response = await fetch(url + "users/123");
      const data = await response.json();
      
      console.log(JSON.stringify(data));
      server.stop();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain('"userId":"123"');
});

test("Express shim with bun.serve - POST with JSON", async () => {
  using dir = tempDir("express-bun-test-post", {
    "server.ts": `
      import express from "../../../../src/js/thirdparty/express-bun";
      
      const app = express();
      
      app.post("/api/data", async (req, res) => {
        // Note: body parsing would need to be implemented
        res.json({ received: true });
      });
      
      const server = Bun.serve({
        port: 0,
        fetch: app.fetch.bind(app),
      });
      
      const url = server.url.href;
      const response = await fetch(url + "api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "data" }),
      });
      const data = await response.json();
      
      console.log(JSON.stringify(data));
      server.stop();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain('"received":true');
});

test("Express shim - 404 for unmatched routes", async () => {
  using dir = tempDir("express-bun-test-404", {
    "server.ts": `
      import express from "../../../../src/js/thirdparty/express-bun";
      
      const app = express();
      
      app.get("/api/hotels", (req, res) => {
        res.json({ success: true });
      });
      
      const server = Bun.serve({
        port: 0,
        fetch: app.fetch.bind(app),
      });
      
      const url = server.url.href;
      const response = await fetch(url + "api/hotels", {
        method: "POST",
      });
      
      console.log(response.status);
      server.stop();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("404");
});

