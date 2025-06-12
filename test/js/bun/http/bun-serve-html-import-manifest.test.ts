import { describe, expect, test } from "bun:test";
import { serve } from "bun";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, writeFile } from "fs/promises";

describe("HTML import manifest", () => {
  test("serves files from pre-bundled HTML import manifest", async () => {
    // Create a temporary directory with test files
    const dir = await mkdtemp(join(tmpdir(), "bun-test-"));
    await writeFile(join(dir, "index.html"), "<html><body>Hello World</body></html>");
    await writeFile(join(dir, "index.js"), "console.log('hello');");
    await writeFile(join(dir, "index.css"), "body { margin: 0; }");
    await writeFile(join(dir, "logo.svg"), "<svg></svg>");

    // Create a manifest object that mimics the output of HTMLImportManifest
    const manifest = {
      index: "./index.html",
      files: [
        {
          input: "index.html",
          path: join(dir, "index.html"),
          loader: "html",
          isEntry: true,
          headers: {
            etag: "test123",
            "content-type": "text/html;charset=utf-8",
          },
        },
        {
          input: "index.html",
          path: join(dir, "index.js"),
          loader: "js",
          isEntry: true,
          headers: {
            etag: "test456",
            "content-type": "text/javascript;charset=utf-8",
          },
        },
        {
          input: "index.html",
          path: join(dir, "index.css"),
          loader: "css",
          isEntry: true,
          headers: {
            etag: "test789",
            "content-type": "text/css;charset=utf-8",
          },
        },
        {
          input: "logo.svg",
          path: join(dir, "logo.svg"),
          loader: "file",
          isEntry: false,
          headers: {
            etag: "testabc",
            "content-type": "image/svg+xml",
          },
        },
      ],
    };

    const server = serve({
      port: 0,
      routes: {
        "/": manifest as any,
      },
      fetch() {
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      // Test that the index route serves the HTML file
      const indexRes = await fetch(`${server.url}`);
      expect(indexRes.status).toBe(200);
      expect(indexRes.headers.get("content-type")).toBe("text/html;charset=utf-8");
      expect(indexRes.headers.get("etag")).toBe("test123");
      expect(await indexRes.text()).toBe("<html><body>Hello World</body></html>");

      // Test that the JS file is served at its path
      const jsRes = await fetch(`${server.url}${join(dir, "index.js")}`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
      expect(jsRes.headers.get("etag")).toBe("test456");
      expect(await jsRes.text()).toBe("console.log('hello');");

      // Test that the CSS file is served
      const cssRes = await fetch(`${server.url}${join(dir, "index.css")}`);
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers.get("content-type")).toBe("text/css;charset=utf-8");
      expect(cssRes.headers.get("etag")).toBe("test789");
      expect(await cssRes.text()).toBe("body { margin: 0; }");

      // Test that the SVG file is served
      const svgRes = await fetch(`${server.url}${join(dir, "logo.svg")}`);
      expect(svgRes.status).toBe(200);
      expect(svgRes.headers.get("content-type")).toBe("image/svg+xml");
      expect(svgRes.headers.get("etag")).toBe("testabc");
      expect(await svgRes.text()).toBe("<svg></svg>");

      // Test that non-existent routes return 404
      const notFoundRes = await fetch(`${server.url}not-found`);
      expect(notFoundRes.status).toBe(404);
      expect(await notFoundRes.text()).toBe("Not found");
    } finally {
      server.stop(true);
    }
  });

  test("supports relative paths in manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bun-test-"));
    await writeFile(join(dir, "index.html"), "<html><body>Relative paths</body></html>");
    await writeFile(join(dir, "app.js"), "export default 'app';");

    const manifest = {
      index: "./index.html",
      files: [
        {
          input: "index.html",
          path: "./index.html",
          loader: "html",
          isEntry: true,
          headers: {
            "content-type": "text/html",
          },
        },
        {
          input: "app.js",
          path: "./app.js",
          loader: "js",
          isEntry: false,
          headers: {
            "content-type": "application/javascript",
          },
        },
      ],
    };

    // Change to the test directory
    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      const server = serve({
        port: 0,
        routes: {
          "/": manifest as any,
        },
        fetch() {
          return new Response("Not found", { status: 404 });
        },
      });

      try {
        const indexRes = await fetch(`${server.url}`);
        expect(indexRes.status).toBe(200);
        expect(await indexRes.text()).toBe("<html><body>Relative paths</body></html>");

        const jsRes = await fetch(`${server.url}app.js`);
        expect(jsRes.status).toBe(200);
        expect(await jsRes.text()).toBe("export default 'app';");
      } finally {
        server.stop(true);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("throws error when files array is empty", () => {
    const manifest = {
      index: "./index.html",
      files: [],
    };

    expect(() => {
      serve({
        port: 0,
        routes: {
          "/": manifest as any,
        },
        fetch() {
          return new Response("Not found", { status: 404 });
        },
      });
    }).toThrow("HTML import manifest 'files' array is empty");
  });

  test("throws error when index file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bun-test-"));
    await writeFile(join(dir, "app.js"), "console.log('app');");

    const manifest = {
      index: "./index.html",
      files: [
        {
          input: "app.js",
          path: join(dir, "app.js"),
          loader: "js",
          isEntry: false,
          headers: {
            "content-type": "application/javascript",
          },
        },
      ],
    };

    expect(() => {
      serve({
        port: 0,
        routes: {
          "/": manifest as any,
        },
        fetch() {
          return new Response("Not found", { status: 404 });
        },
      });
    }).toThrow("HTML import manifest missing index.html file");
  });

  test("handles manifest with different index file paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bun-test-"));
    await writeFile(join(dir, "index.html"), "<html>Index</html>");

    const testCases = ["./index.html", "index.html", join(dir, "index.html")];

    for (const indexPath of testCases) {
      const manifest = {
        index: indexPath,
        files: [
          {
            input: "index.html",
            path: indexPath,
            loader: "html",
            isEntry: true,
            headers: {
              "content-type": "text/html",
            },
          },
        ],
      };

      const server = serve({
        port: 0,
        routes: {
          "/test": manifest as any,
        },
        fetch() {
          return new Response("Not found", { status: 404 });
        },
      });

      try {
        const res = await fetch(`${server.url}test`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("<html>Index</html>");
      } finally {
        server.stop(true);
      }
    }
  });

  test("does not confuse manifest with HTMLBundle", async () => {
    // This test ensures that objects with "index" and "files" properties
    // but that are actually HTMLBundle instances are not treated as manifests

    // Create a mock object that looks like HTMLBundle but has index/files
    const notManifest = {
      index: "./fake.html",
      files: "not-an-array", // Invalid files property
      // Add some property that real HTMLBundle might have
      path: "./real-bundle.html",
    };

    const server = serve({
      port: 0,
      routes: {
        "/": notManifest as any,
      },
      fetch() {
        return new Response("Fallback");
      },
    });

    try {
      // Should fall through to the fetch handler since it's not a valid manifest
      const res = await fetch(`${server.url}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Fallback");
    } finally {
      server.stop(true);
    }
  });
});
