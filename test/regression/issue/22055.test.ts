import { test, expect } from "bun:test";
import {
  bunEnv,
  bunExe,
  tempDirWithFiles,
} from "harness";

test("Bun.serve returns plain text errors for non-browser User-Agent (#22055)", async () => {
  const dir = tempDirWithFiles("user-agent-error-test", {
    "app.js": `
      export default {
        port: 0,
        fetch(req) {
          // Create a syntax error to trigger the error page
          if (true) throw new Error("Test error for user agent detection");
          return new Response('Hello');
        }
      }
    `,
    "package.json": JSON.stringify({
      name: "user-agent-test",
      type: "module",
    }),
  });

  // Start the dev server
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--bun", "app.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Wait a bit for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Extract port from stdout
  const stdout = await proc.stdout.text();
  const portMatch = stdout.match(/port (\d+)/);
  if (!portMatch) {
    console.log("Server output:", stdout);
    throw new Error("Could not find port in server output");
  }
  const port = portMatch[1];

  try {
    // Test with browser User-Agent (should get HTML)
    const browserResponse = await fetch(`http://localhost:${port}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });
    
    expect(browserResponse.status).toBe(500);
    const browserText = await browserResponse.text();
    expect(browserResponse.headers.get("content-type")).toContain("text/html");
    expect(browserText).toContain("<!doctype html>");
    expect(browserText).toContain("Runtime Error");

    // Test with non-browser User-Agent (should get plain text)
    const fetchResponse = await fetch(`http://localhost:${port}/`, {
      headers: {
        "User-Agent": "fetch/1.0"
      }
    });
    
    expect(fetchResponse.status).toBe(500);
    const fetchText = await fetchResponse.text();
    expect(fetchResponse.headers.get("content-type")).toContain("text/plain");
    expect(fetchText).toContain("Runtime Error");
    expect(fetchText).toContain("Bun development server encountered an error");
    expect(fetchText).not.toContain("<!doctype html>");
    expect(fetchText).not.toContain("<script>");

  } finally {
    proc.kill();
  }
}, 10000);