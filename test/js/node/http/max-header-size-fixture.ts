import http from "node:http";

if (http.maxHeaderSize !== parseInt(process.env.BUN_HTTP_MAX_HEADER_SIZE, 10)) {
  throw new Error("BUN_HTTP_MAX_HEADER_SIZE is not set to the correct value");
}

using server = Bun.serve({
  port: 0,
  fetch(req) {
    return new Response(JSON.stringify(req.headers, null, 2));
  },
});

await fetch(`${server.url}/`, {
  headers: {
    "Huge": Buffer.alloc(Math.max(http.maxHeaderSize, 256) - 256, "abc").toString(),
  },
});

try {
  await fetch(`${server.url}/`, {
    headers: {
      "Huge": Buffer.alloc(http.maxHeaderSize + 1024, "abc").toString(),
    },
  });
  throw new Error("bad");
} catch (e) {
  if (e.message.includes("bad")) {
    process.exit(1);
  }

  process.exit(0);
}
