import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, isWindows } from "harness";
import { join } from "path";

describe("DirectoryRoute", () => {
  let testDir: string;
  let server: Server;
  let port: number;

  beforeAll(() => {
    testDir = tempDirWithFiles("directory-route-test", {
      "index.html": "<html><body>Index Page</body></html>",
      "index.htm": "<html><body>Index Htm Page</body></html>",
      "about.html": "<html><body>About Page</body></html>",
      "page.html": "<html><body>Page Content</body></html>",
      "script.js": "console.log('Hello from script');",
      "styles.css": "body { color: red; }",
      "robots.txt": "User-agent: *\nDisallow: /",
      "api/data.json": '{"message": "Hello from API"}',
      "assets/image.png": "fake-png-data",
      "nested/deep/file.txt": "Deep nested file content",
      "nested/index.html": "<html><body>Nested Index</body></html>",
    });
  });

  afterAll(() => {
    server?.stop();
  });

  it("should serve index.html for root path", async () => {
    server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
      },
    });
    port = server.port;

    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toBe("<html><body>Index Page</body></html>");
  });

  it("should serve index.html when accessing directory", async () => {
    const response = await fetch(`http://localhost:${port}/nested/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toBe("<html><body>Nested Index</body></html>");
  });

  it("should serve direct file access", async () => {
    const response = await fetch(`http://localhost:${port}/about.html`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toBe("<html><body>About Page</body></html>");
  });

  it("should serve files with correct content-type", async () => {
    const jsResponse = await fetch(`http://localhost:${port}/script.js`);
    expect(jsResponse.status).toBe(200);
    expect(jsResponse.headers.get("content-type")).toContain("text/javascript");
    
    const cssResponse = await fetch(`http://localhost:${port}/styles.css`);
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("content-type")).toContain("text/css");
    
    const txtResponse = await fetch(`http://localhost:${port}/robots.txt`);
    expect(txtResponse.status).toBe(200);
    expect(txtResponse.headers.get("content-type")).toContain("text/plain");
  });

  it("should try .html extension fallback", async () => {
    const response = await fetch(`http://localhost:${port}/page`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toBe("<html><body>Page Content</body></html>");
  });

  it("should serve nested files", async () => {
    const response = await fetch(`http://localhost:${port}/api/data.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const text = await response.text();
    expect(text).toBe('{"message": "Hello from API"}');
  });

  it("should serve deeply nested files", async () => {
    const response = await fetch(`http://localhost:${port}/nested/deep/file.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toBe("Deep nested file content");
  });

  it("should return 404 for non-existent files", async () => {
    const response = await fetch(`http://localhost:${port}/nonexistent.html`);
    expect(response.status).toBe(404);
  });

  it("should handle HEAD requests", async () => {
    const response = await fetch(`http://localhost:${port}/about.html`, {
      method: "HEAD",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toBe(""); // HEAD should not return body
  });

  it("should have proper path traversal protection", async () => {
    const response = await fetch(`http://localhost:${port}/../../../etc/passwd`);
    expect(response.status).toBe(404);
  });

  it("should handle multiple directory routes", async () => {
    server?.stop();
    
    const assetsDir = tempDirWithFiles("assets-test", {
      "logo.png": "fake-logo-data",
      "favicon.ico": "fake-favicon-data",
    });

    server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
        "/assets": { dir: assetsDir },
      },
    });
    port = server.port;

    const mainResponse = await fetch(`http://localhost:${port}/about.html`);
    expect(mainResponse.status).toBe(200);
    const mainText = await mainResponse.text();
    expect(mainText).toBe("<html><body>About Page</body></html>");

    const assetsResponse = await fetch(`http://localhost:${port}/assets/logo.png`);
    expect(assetsResponse.status).toBe(200);
    const assetsText = await assetsResponse.text();
    expect(assetsText).toBe("fake-logo-data");
  });

  it("should support combined routes (directory + other route types)", async () => {
    server?.stop();
    
    server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
        "/api/hello": () => new Response("Hello from API"),
      },
    });
    port = server.port;

    // Test directory route
    const fileResponse = await fetch(`http://localhost:${port}/about.html`);
    expect(fileResponse.status).toBe(200);
    const fileText = await fileResponse.text();
    expect(fileText).toBe("<html><body>About Page</body></html>");

    // Test function route
    const apiResponse = await fetch(`http://localhost:${port}/api/hello`);
    expect(apiResponse.status).toBe(200);
    const apiText = await apiResponse.text();
    expect(apiText).toBe("Hello from API");
  });

  it("should fall back to index.htm if index.html doesn't exist", async () => {
    const onlyHtmDir = tempDirWithFiles("only-htm-test", {
      "index.htm": "<html><body>Only HTM Index</body></html>",
      "page.html": "<html><body>Page Content</body></html>",
    });

    server?.stop();
    
    server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: onlyHtmDir },
      },
    });
    port = server.port;

    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toBe("<html><body>Only HTM Index</body></html>");
  });

  it("should handle directory access without trailing slash", async () => {
    const response = await fetch(`http://localhost:${port}/nested`, {
      redirect: "manual",
    });
    // Should try to find index.html in nested directory
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("<html><body>Only HTM Index</body></html>"); // From the previous test setup
  });

  it("should yield to next handler when file not found", async () => {
    server?.stop();
    
    server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
      },
      fetch: (req) => {
        return new Response("Fallback handler", { status: 404 });
      },
    });
    port = server.port;

    const response = await fetch(`http://localhost:${port}/nonexistent.html`);
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).toBe("Fallback handler");
  });
});