import { describe, expect, test } from "bun:test";
import { serve } from "bun";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, writeFile } from "fs/promises";

describe("HTML import manifest", () => {
  test("serves files from pre-bundled HTML import manifest", async () => {
    // Create a temporary directory with test files
    const dir = await mkdtemp(join(tmpdir(), "bun-test-"));
    await writeFile(join(dir, "main.html"), "<html><body>Hello World</body></html>");
    await writeFile(join(dir, "app.js"), "console.log('hello');");
    await writeFile(join(dir, "styles.css"), "body { margin: 0; }");
    await writeFile(join(dir, "logo.svg"), "<svg></svg>");

    // Create a manifest object that mimics the output of HTMLImportManifest
    const manifest = {
      index: join(dir, "main.html"),
      files: [
        {
          input: "main.html",
          path: join(dir, "main.html"),
          loader: "html",
          isEntry: true,
          headers: {
            etag: "test123",
            "content-type": "text/html;charset=utf-8",
          },
        },
        {
          input: "app.js",
          path: join(dir, "app.js"),
          loader: "js",
          isEntry: true,
          headers: {
            etag: "test456",
            "content-type": "text/javascript;charset=utf-8",
          },
        },
        {
          input: "styles.css",
          path: join(dir, "styles.css"),
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
      const jsRes = await fetch(`${server.url}${join(dir, "app.js")}`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
      expect(jsRes.headers.get("etag")).toBe("test456");
      expect(await jsRes.text()).toBe("console.log('hello');");

      // Test that the CSS file is served
      const cssRes = await fetch(`${server.url}${join(dir, "styles.css")}`);
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
    await writeFile(join(dir, "home.html"), "<html><body>Relative paths</body></html>");
    await writeFile(join(dir, "app.js"), "export default 'app';");

    const manifest = {
      index: "./home.html",
      files: [
        {
          input: "home.html",
          path: "./home.html",
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
      index: "./missing-file.html", // This file doesn't exist in the files array
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
    }).toThrow("HTML import manifest index file './missing-file.html' not found in files array");
  });

  test("handles manifest with different index file names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bun-test-"));
    await writeFile(join(dir, "home.html"), "<html>Home page</html>");
    await writeFile(join(dir, "about.html"), "<html>About page</html>");
    await writeFile(join(dir, "contact.html"), "<html>Contact page</html>");

    const testCases = [
      { index: join(dir, "home.html"), expected: "<html>Home page</html>" },
      { index: join(dir, "about.html"), expected: "<html>About page</html>" },
      { index: join(dir, "contact.html"), expected: "<html>Contact page</html>" },
    ];

    for (const { index, expected } of testCases) {
      const manifest = {
        index: index,
        files: [
          {
            input: "home.html",
            path: join(dir, "home.html"),
            loader: "html",
            isEntry: true,
            headers: {
              "content-type": "text/html",
            },
          },
          {
            input: "about.html",
            path: join(dir, "about.html"),
            loader: "html",
            isEntry: true,
            headers: {
              "content-type": "text/html",
            },
          },
          {
            input: "contact.html",
            path: join(dir, "contact.html"),
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
        expect(await res.text()).toBe(expected);
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

  test("copies all headers from manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bun-test-"));
    await writeFile(join(dir, "page.html"), "<html>Test headers</html>");
    await writeFile(join(dir, "script.js"), "console.log('test');");

    const manifest = {
      index: join(dir, "page.html"),
      files: [
        {
          input: "page.html",
          path: join(dir, "page.html"),
          loader: "html",
          isEntry: true,
          headers: {
            "content-type": "text/html;charset=utf-8",
            "etag": 'w/"abc123"',
            "cache-control": "public, max-age=3600",
            "x-custom-header": "custom-value",
            "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
          },
        },
        {
          input: "script.js",
          path: join(dir, "script.js"),
          loader: "js",
          isEntry: true,
          headers: {
            "content-type": "application/javascript",
            "content-encoding": "gzip",
            "vary": "Accept-Encoding",
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
      // Test that all headers are copied for the HTML file
      const htmlRes = await fetch(`${server.url}`);
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.headers.get("content-type")).toBe("text/html;charset=utf-8");
      expect(htmlRes.headers.get("etag")).toBe('w/"abc123"');
      expect(htmlRes.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(htmlRes.headers.get("x-custom-header")).toBe("custom-value");
      expect(htmlRes.headers.get("last-modified")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");

      // Test headers for JS file
      const jsRes = await fetch(`${server.url}${join(dir, "script.js")}`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-type")).toBe("application/javascript");
      expect(jsRes.headers.get("content-encoding")).toBe("gzip");
      expect(jsRes.headers.get("vary")).toBe("Accept-Encoding");
    } finally {
      server.stop(true);
    }
  });
});
