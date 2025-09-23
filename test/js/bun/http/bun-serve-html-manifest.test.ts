import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, rmScope, tempDirWithFiles } from "harness";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

describe("Bun.serve HTML manifest", () => {
  it("serves HTML import with manifest", async () => {
    const dir = tempDirWithFiles("serve-html", {
      "server.ts": `
        import index from "./index.html";
        
        const server = Bun.serve({
          port: 0,
          routes: {
            "/": index,
          },
        });
        
        console.log("PORT=" + server.port);
        
        // Test the manifest structure
        console.log("Manifest type:", typeof index);
        console.log("Has index:", "index" in index);
        console.log("Has files:", "files" in index);
        if (index.files) {
          console.log("File count:", index.files.length);
        }
      `,
      "index.html": `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <h1>Hello World</h1>
  <script src="./app.js"></script>
</body>
</html>`,
      "styles.css": `body { background: red; }`,
      "app.js": `console.log("Hello from app");`,
    });

    using cleanup = { [Symbol.dispose]: () => rmScope(dir) };

    const proc = Bun.spawn({
      cmd: [bunExe(), "run", join(dir, "server.ts")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const { stdout, stderr, exited } = proc;

    // Read stdout line by line until we get the PORT
    let port: number | undefined;
    const reader = stdout.getReader();
    const decoder = new StringDecoder("utf8");
    let buffer = "";

    while (!port) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.write(value);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const portMatch = line.match(/PORT=(\d+)/);
        if (portMatch) {
          port = parseInt(portMatch[1]);
          break;
        }
      }
    }

    reader.releaseLock();
    expect(port).toBeDefined();

    if (port) {
      // Test the server
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("Hello World");
      expect(html).toContain("<script");
      expect(html).toContain("<link");
    }

    proc.kill();
    await exited;
  });

  it("serves HTML with bundled assets", async () => {
    const dir = tempDirWithFiles("serve-html-bundled", {
      "build.ts": `
        const result = await Bun.build({
          entrypoints: ["./server.ts"],
          target: "bun",
          outdir: "./dist",
        });
        
        if (!result.success) {
          console.error("Build failed");
          process.exit(1);
        }
        
        console.log("Build complete");
      `,
      "server.ts": `
        import index from "./index.html";
        import about from "./about.html";
        
        const server = Bun.serve({
          port: 0,
          routes: {
            "/": index,
            "/about": about,
          },
        });
        
        console.log("PORT=" + server.port);
      `,
      "index.html": `<!DOCTYPE html>
<html>
<head>
  <title>Home</title>
  <link rel="stylesheet" href="./shared.css">
</head>
<body>
  <h1>Home Page</h1>
  <script src="./app.js"></script>
</body>
</html>`,
      "about.html": `<!DOCTYPE html>
<html>
<head>
  <title>About</title>
  <link rel="stylesheet" href="./shared.css">
</head>
<body>
  <h1>About Page</h1>
  <script src="./app.js"></script>
</body>
</html>`,
      "shared.css": `body { margin: 0; }`,
      "app.js": `console.log("App loaded");`,
    });

    using cleanup = { [Symbol.dispose]: () => rmScope(dir) };

    // Build first
    const buildProc = Bun.spawn({
      cmd: [bunExe(), "run", join(dir, "build.ts")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    await buildProc.exited;
    expect(buildProc.exitCode).toBe(0);

    // Run the built server
    const serverProc = Bun.spawn({
      cmd: [bunExe(), "run", join(dir, "dist", "server.js")],
      cwd: join(dir, "dist"),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    // Read stdout line by line until we get the PORT
    let port: number | undefined;
    const reader = serverProc.stdout.getReader();
    const decoder = new StringDecoder("utf8");
    let buffer = "";

    while (!port) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.write(value);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const portMatch = line.match(/PORT=(\d+)/);
        if (portMatch) {
          port = parseInt(portMatch[1]);
          break;
        }
      }
    }

    reader.releaseLock();
    expect(port).toBeDefined();

    if (port) {
      // Test both routes
      const homeRes = await fetch(`http://localhost:${port}/`);
      expect(homeRes.status).toBe(200);
      const homeHtml = await homeRes.text();
      expect(homeHtml).toContain("Home Page");

      const aboutRes = await fetch(`http://localhost:${port}/about`);
      expect(aboutRes.status).toBe(200);
      const aboutHtml = await aboutRes.text();
      expect(aboutHtml).toContain("About Page");
    }

    serverProc.kill();
    await serverProc.exited;
  });

  it("validates manifest files exist", async () => {
    const dir = tempDirWithFiles("serve-html-validate", {
      "test.ts": `
        // Create a fake manifest
        const fakeManifest = {
          index: "./index.html",
          files: [
            {
              input: "index.html",
              path: "./does-not-exist.html",
              loader: "html",
              isEntry: true,
              headers: {
                etag: "test123",
                "content-type": "text/html;charset=utf-8"
              }
            }
          ]
        };

        try {
          const server = Bun.serve({
            port: 0,
            routes: {
              "/": fakeManifest,
            },
          });
          console.log("ERROR: Server started when it should have failed");
          server.stop();
        } catch (error) {
          console.log("SUCCESS: Manifest validation failed as expected");
        }
      `,
    });

    using cleanup = { [Symbol.dispose]: () => rmScope(dir) };

    const proc = Bun.spawn({
      cmd: [bunExe(), "run", join(dir, "test.ts")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const out = await proc.stdout.text();
    await proc.exited;

    expect(out).toContain("SUCCESS: Manifest validation failed as expected");
  });

  it("serves manifest with proper headers", async () => {
    const dir = tempDirWithFiles("serve-html-headers", {
      "server.ts": `
        import index from "./index.html";
        
        using server = Bun.serve({
          port: 0,
          routes: {
            "/": index,
          },
        });
        
        console.log("PORT=" + server.port);
        
        // Check manifest structure
        if (index.files) {
          for (const file of index.files) {
            console.log("File:", file.path, "Loader:", file.loader);
            if (file.headers) {
              console.log("  Content-Type:", file.headers["content-type"]);
              console.log("  Has ETag:", !!file.headers.etag);
            }
          }
        }
      `,
      "index.html": `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
  <link rel="stylesheet" href="./test.css">
</head>
<body>
  <h1>Test</h1>
</body>
</html>`,
      "test.css": `h1 { color: red; }`,
    });

    using cleanup = { [Symbol.dispose]: () => rmScope(dir) };

    // Build first to generate the manifest
    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "build", join(dir, "server.ts"), "--outdir", join(dir, "dist"), "--target", "bun"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    await buildProc.exited;
    expect(buildProc.exitCode).toBe(0);

    // Run the built server
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(dir, "dist", "server.js")],
      cwd: join(dir, "dist"),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    // Read stdout line by line to collect all output
    const out = await proc.stdout.text();
    expect(await proc.exited).toBe(0);

    expect(
      out
        .trim()
        .replaceAll(/PORT=\d+/g, "PORT=99999")
        .replaceAll(/.\/index-[a-z0-9]+\.js/g, "index-[hash].js")
        .replaceAll(/.\/index-[a-z0-9]+\.css/g, "index-[hash].css"),
    ).toMatchInlineSnapshot(`
      "PORT=99999
      File: index-[hash].js Loader: js
        Content-Type: text/javascript;charset=utf-8
        Has ETag: true
      File: ./index.html Loader: html
        Content-Type: text/html;charset=utf-8
        Has ETag: true
      File: index-[hash].css Loader: css
        Content-Type: text/css;charset=utf-8
        Has ETag: true"
    `);
  });
});
