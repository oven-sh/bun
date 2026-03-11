import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("HTML imports Cache-Control headers (#27996)", () => {
  for (const development of [true, false]) {
    test(`content-hashed assets ${development ? "omit" : "include"} Cache-Control when development: ${development}`, async () => {
      const dir = tempDirWithFiles("html-cache-control", {
        "index.html": `<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="./style.css" /></head>
<body><script type="module" src="./app.ts"></script></body>
</html>`,
        "style.css": `body { background: red; }`,
        "app.ts": `console.log("hello")`,
        "server.ts": `
import index from "./index.html";

const server = Bun.serve({
  development: ${development},
  port: 0,
  routes: { "/": index },
});

// Signal the port to the parent process
process.send(server.port);
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "server.ts"],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        ipc(message) {
          portResolve(message as number);
        },
      });

      let portResolve: (port: number) => void;
      const portPromise = new Promise<number>(r => {
        portResolve = r;
      });

      const port = await portPromise;
      const baseUrl = `http://localhost:${port}`;

      // Fetch the HTML page to discover asset URLs
      const htmlResponse = await fetch(baseUrl);
      expect(htmlResponse.status).toBe(200);
      const htmlText = await htmlResponse.text();

      // HTML page itself should NOT have Cache-Control
      expect(htmlResponse.headers.get("cache-control")).toBeNull();

      // Extract chunk URLs from the HTML
      const cssMatch = htmlText.match(/href="([^"]+\.css)"/);
      const jsMatch = htmlText.match(/src="([^"]+\.js)"/);

      if (!cssMatch) throw new Error("CSS asset URL not found in HTML: " + htmlText);
      if (!jsMatch) throw new Error("JS asset URL not found in HTML: " + htmlText);

      // Fetch CSS asset and check headers
      const cssResponse = await fetch(new URL(cssMatch[1], baseUrl));
      expect(cssResponse.headers.get("etag")).not.toBeNull();
      expect(cssResponse.headers.get("content-type")).toBe("text/css;charset=utf-8");
      expect(cssResponse.status).toBe(200);

      // Fetch JS asset and check headers
      const jsResponse = await fetch(new URL(jsMatch[1], baseUrl));
      expect(jsResponse.headers.get("etag")).not.toBeNull();
      expect(jsResponse.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
      expect(jsResponse.status).toBe(200);

      if (development) {
        // In development mode, Cache-Control should NOT be set
        expect(cssResponse.headers.get("cache-control")).toBeNull();
        expect(jsResponse.headers.get("cache-control")).toBeNull();
      } else {
        // In production mode, content-hashed assets should have Cache-Control
        expect(cssResponse.headers.get("cache-control")).toBe("public, max-age=31536000");
        expect(jsResponse.headers.get("cache-control")).toBe("public, max-age=31536000");
      }

      proc.kill();
    });
  }
});
