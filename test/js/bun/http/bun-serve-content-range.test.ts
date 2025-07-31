import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import type { Server } from "bun";

describe("Content-Range support in static routes", () => {
  let server: Server;
  const port = 9999;
  const baseURL = `http://localhost:${port}`;

  // Test content of various sizes
  const smallContent = "Hello, World! This is a small test content for range requests.";
  const mediumContent = "x".repeat(10000); // 10KB
  const largeContent = "y".repeat(100000); // 100KB

  const routes = {
    "/small": new Response(smallContent, {
      headers: { "Content-Type": "text/plain" },
    }),
    "/medium": new Response(mediumContent, {
      headers: { "Content-Type": "text/plain" },
    }),
    "/large": new Response(largeContent, {
      headers: { "Content-Type": "text/plain" },
    }),
    "/empty": new Response("", {
      headers: { "Content-Type": "text/plain" },
    }),
    "/with-etag": new Response("Content with ETag", {
      headers: { 
        "Content-Type": "text/plain",
        "ETag": '"custom-etag"',
      },
    }),
  };

  beforeAll(async () => {
    server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        const response = routes[url.pathname];
        if (response) {
          return response.clone();
        }
        return new Response("Not Found", { status: 404 });
      },
      static: routes,
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(() => {
    if (server) {
      server.stop();
    }
  });

  test("normal GET request includes Accept-Ranges header", async () => {
    const response = await fetch(`${baseURL}/small`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe(smallContent);
  });

  test("single range request - start and end specified", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "bytes=7-12" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 7-12/${smallContent.length}`);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("6");
    expect(await response.text()).toBe("World!");
  });

  test("single range request - start only (open-ended)", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "bytes=7-" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 7-${smallContent.length - 1}/${smallContent.length}`);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe(smallContent.slice(7));
  });

  test("suffix range request - last N bytes", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "bytes=-13" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes ${smallContent.length - 13}-${smallContent.length - 1}/${smallContent.length}`);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe(smallContent.slice(-13));
  });

  test("range request for entire content returns 200 instead of 206", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: `bytes=0-${smallContent.length - 1}` },
    });

    // Should return full content with 200 status when range covers entire content
    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe(smallContent);
  });

  test("invalid range - start greater than content length", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: `bytes=${smallContent.length + 10}-` },
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe(`bytes */${smallContent.length}`);
    expect(await response.text()).toBe("");
  });

  test("invalid range - end before start", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "bytes=20-10" },
    });

    // Invalid range spec should fall back to full content
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(smallContent);
  });

  test("malformed range header", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "invalid-range-header" },
    });

    // Invalid range header should fall back to full content
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(smallContent);
  });

  test("range request on empty content", async () => {
    const response = await fetch(`${baseURL}/empty`, {
      headers: { Range: "bytes=0-10" },
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */0");
  });

  test("range request preserves original headers", async () => {
    const response = await fetch(`${baseURL}/with-etag`, {
      headers: { Range: "bytes=0-7" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("ETag")).toBe('"custom-etag"');
    expect(response.headers.get("Content-Range")).toBe("bytes 0-7/17");
    expect(await response.text()).toBe("Content ");
  });

  test("multiple ranges fall back to full content", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "bytes=0-10,20-30" },
    });

    // Multiple ranges not implemented yet, should fall back to full content
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(smallContent);
  });

  test("large content range request", async () => {
    const response = await fetch(`${baseURL}/large`, {
      headers: { Range: "bytes=1000-2000" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 1000-2000/${largeContent.length}`);
    expect(response.headers.get("Content-Length")).toBe("1001");
    expect(await response.text()).toBe(largeContent.slice(1000, 2001));
  });

  test("range request at content boundaries", async () => {
    // Test range at the very end of content
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: `bytes=${smallContent.length - 1}-${smallContent.length - 1}` },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes ${smallContent.length - 1}-${smallContent.length - 1}/${smallContent.length}`);
    expect(response.headers.get("Content-Length")).toBe("1");
    expect(await response.text()).toBe(smallContent.slice(-1));
  });

  test("suffix range larger than content", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: `bytes=-${smallContent.length + 100}` },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 0-${smallContent.length - 1}/${smallContent.length}`);
    expect(await response.text()).toBe(smallContent);
  });

  test("HEAD request with range should not include body", async () => {
    const response = await fetch(`${baseURL}/small`, {
      method: "HEAD",
      headers: { Range: "bytes=7-12" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 7-12/${smallContent.length}`);
    expect(response.headers.get("Content-Length")).toBe("6");
    expect(await response.text()).toBe("");
  });

  test("range request with If-None-Match (cache validation)", async () => {
    // First get the ETag
    const initialResponse = await fetch(`${baseURL}/with-etag`);
    const etag = initialResponse.headers.get("ETag");
    expect(etag).toBeTruthy();

    // Then make a range request with If-None-Match
    const response = await fetch(`${baseURL}/with-etag`, {
      headers: { 
        Range: "bytes=0-7",
        "If-None-Match": etag!,
      },
    });

    // Should return 304 Not Modified, not 206 Partial Content
    expect(response.status).toBe(304);
  });

  test("range request on medium-sized content", async () => {
    const response = await fetch(`${baseURL}/medium`, {
      headers: { Range: "bytes=100-199" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 100-199/${mediumContent.length}`);
    expect(response.headers.get("Content-Length")).toBe("100");
    expect(await response.text()).toBe(mediumContent.slice(100, 200));
  });

  test("range request with whitespace in header", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "  bytes=7 - 12  " },
    });

    // Should handle whitespace gracefully
    expect(response.status).toBe(200); // Falls back to full content due to parsing
    expect(await response.text()).toBe(smallContent);
  });

  test("case insensitive range unit", async () => {
    const response = await fetch(`${baseURL}/small`, {
      headers: { Range: "BYTES=7-12" },
    });

    // Case insensitive parsing is not implemented, should fall back
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(smallContent);
  });
});

describe("Content-Range unit tests", () => {
  test("ContentRange.zig unit tests should pass", async () => {
    // Run the built-in unit tests for ContentRange.zig
    using proc = Bun.spawn({
      cmd: [bunExe(), "bd", "test", "src/http/ContentRange.zig"],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.error("ContentRange.zig test stderr:", stderr);
      console.error("ContentRange.zig test stdout:", stdout);
    }

    expect(exitCode).toBe(0);
  });
});