import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("Bun.serve routes with Bun.file work in standalone executables (--compile)", async () => {
  using dir = tempDir("test-standalone-bunfile", {
    "index.html": `<!DOCTYPE html>
<html>
<head><title>Standalone Test</title></head>
<body><h1>Hello from standalone!</h1></body>
</html>`,
    "style.css": `body { background: blue; color: white; }`,
    "app.js": `console.log("App loaded!");`,
    "server.ts": `
// Import files with { type: "file" } to bundle them into the executable
import indexPath from "./index.html" with { type: "file" };
import stylePath from "./style.css" with { type: "file" };
import appPath from "./app.js" with { type: "file" };

console.log("Virtual paths:", {
  index: indexPath,
  style: stylePath,
  app: appPath
});

const server = Bun.serve({
  port: 0,
  routes: {
    // Direct Bun.file() - this is what the fix enables
    "/": Bun.file(indexPath),
    "/style.css": Bun.file(stylePath),
    "/app.js": Bun.file(appPath),

    // Also test wrapped in Response
    "/wrapped": new Response(Bun.file(indexPath)),

    // Test plain Response
    "/api/test": Response.json({ message: "Hello from API" }),
  },
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("PORT:" + server.port);

// Keep server running for tests
setTimeout(() => {
  server.stop();
  process.exit(0);
}, 10000);
`,
  });

  // Build standalone executable with our debug build
  const buildProc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--outfile",
      path.join(String(dir), "server"),
      path.join(String(dir), "server.ts"),
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildResult] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  if (buildResult !== 0) {
    console.error("Build failed:", { stdout: buildStdout, stderr: buildStderr });
  }
  expect(buildResult).toBe(0);

  // Make the executable file executable (just in case)
  const serverPath = path.join(String(dir), "server");

  // Run the standalone executable
  const serverProc = Bun.spawn({
    cmd: [serverPath],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Get the port from stdout
  let output = "";
  const reader = serverProc.stdout.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = new TextDecoder().decode(value);
    output += text;
    if (output.includes("PORT:")) break;
  }

  // Check that virtual paths were printed
  expect(output).toContain("/$bunfs/root/");

  const port = output.match(/PORT:(\d+)/)?.[1];
  expect(port).toBeDefined();

  const baseURL = `http://localhost:${port}`;

  // Test direct Bun.file() route (the main fix)
  {
    const response = await fetch(baseURL + "/");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Hello from standalone!");
    expect(text).toContain("<title>Standalone Test</title>");
  }

  // Test CSS file
  {
    const response = await fetch(baseURL + "/style.css");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("background: blue");
    expect(text).toContain("color: white");
  }

  // Test JS file
  {
    const response = await fetch(baseURL + "/app.js");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("App loaded!");
  }

  // Test wrapped Response
  {
    const response = await fetch(baseURL + "/wrapped");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Hello from standalone!");
  }

  // Test API route
  {
    const response = await fetch(baseURL + "/api/test");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.message).toBe("Hello from API");
  }

  // Test 404
  {
    const response = await fetch(baseURL + "/not-found");
    expect(response.status).toBe(404);
  }

  // Clean up
  serverProc.kill();
  await serverProc.exited;
}, 30000); // 30 second timeout for this test since it involves compilation
