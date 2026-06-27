// https://github.com/oven-sh/bun/issues/27996
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("Bun.serve HTML imports: ETag and Cache-Control headers", () => {
  for (const development of [false, { hmr: false }] as const) {
    test(`development: ${JSON.stringify(development)}`, async () => {
      using dir = tempDir("html-cache-headers", {
        "index.html": `<!DOCTYPE html><html><head><title>t</title><link rel="stylesheet" href="./app.css"></head><body><script type="module" src="./app.ts"></script></body></html>`,
        "app.ts": `import logo from "./logo.svg";\nconsole.log(logo);\n`,
        "app.css": `body { color: red; }\n`,
        "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg"></svg>\n`,
      });
      const { default: html } = await import(join(String(dir), "index.html"));
      using server = Bun.serve({
        port: 0,
        development,
        routes: { "/": html },
        fetch() {
          return new Response("Not found", { status: 404 });
        },
      });

      const htmlResponse = await fetch(server.url);
      expect(htmlResponse.status).toBe(200);
      const htmlText = await htmlResponse.text();
      const htmlETag = htmlResponse.headers.get("etag");

      // HTML route has a quoted ETag.
      expect({ etag: htmlETag }).toEqual({ etag: expect.stringMatching(/^"[0-9a-f]{16}"$/) });

      const jsSrc = htmlText.match(/<script[^>]+ src="([^"]+)"/)![1];
      const cssSrc = htmlText.match(/<link[^>]+ href="([^"]+)"/)![1];
      const jsResponse = await fetch(new URL(jsSrc, server.url));
      const cssResponse = await fetch(new URL(cssSrc, server.url));
      const jsText = await jsResponse.text();
      const svgSrc = jsText.match(/"([^"]+\.svg)"/)![1];
      const svgResponse = await fetch(new URL(svgSrc, server.url));

      expect({ js: jsResponse.status, css: cssResponse.status, svg: svgResponse.status }).toEqual({
        js: 200,
        css: 200,
        svg: 200,
      });

      // Every asset route has a quoted ETag.
      expect({
        js: jsResponse.headers.get("etag"),
        css: cssResponse.headers.get("etag"),
        svg: svgResponse.headers.get("etag"),
      }).toEqual({
        js: expect.stringMatching(/^"[0-9a-f]{16}"$/),
        css: expect.stringMatching(/^"[0-9a-f]{16}"$/),
        svg: expect.stringMatching(/^"[0-9a-f]{16}"$/),
      });

      if (development === false) {
        // Production: HTML revalidates; content-hashed assets are immutable.
        expect({
          html: htmlResponse.headers.get("cache-control"),
          js: jsResponse.headers.get("cache-control"),
          css: cssResponse.headers.get("cache-control"),
          svg: svgResponse.headers.get("cache-control"),
        }).toEqual({
          html: "no-cache",
          js: "public, max-age=31536000, immutable",
          css: "public, max-age=31536000, immutable",
          svg: "public, max-age=31536000, immutable",
        });

        // A conditional request with the HTML ETag returns 304.
        const conditional = await fetch(server.url, { headers: { "If-None-Match": htmlETag! } });
        expect(conditional.status).toBe(304);
      } else {
        // Development: no Cache-Control (content is rebundled per request).
        expect({
          html: htmlResponse.headers.get("cache-control"),
          js: jsResponse.headers.get("cache-control"),
          css: cssResponse.headers.get("cache-control"),
          svg: svgResponse.headers.get("cache-control"),
        }).toEqual({
          html: null,
          js: null,
          css: null,
          svg: null,
        });
      }
    });
  }
});
