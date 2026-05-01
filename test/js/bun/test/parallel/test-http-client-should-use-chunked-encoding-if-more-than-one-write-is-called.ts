import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// Bun.serve is used here until #15576 or similar fix is merged
using server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    if (req.headers.get("transfer-encoding") !== "chunked") {
      return new Response("should be chunked encoding", { status: 500 });
    }
    return new Response(req.body);
  },
});

// Options for the HTTP request
const options = {
  hostname: "127.0.0.1", // Replace with the target server
  port: server.port,
  path: "/api/data",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
};

const { promise, resolve, reject } = Promise.withResolvers();

// Create the request
const req = http.request(options, res => {
  if (res.statusCode !== 200) {
    reject(new Error("Body should be chunked"));
  }
  const chunks = [];
  // Collect the response data
  res.on("data", chunk => {
    chunks.push(chunk);
  });

  res.on("end", () => {
    resolve(chunks);
  });
});

// Handle errors
req.on("error", reject);

// Write chunks to the request body

for (let i = 0; i < 4; i++) {
  req.write("chunk");
  await sleep(50);
  req.write(" ");
  await sleep(50);
}
req.write("BUN!");
// End the request and signal no more data will be sent
req.end();

const chunks = await promise;
expect(chunks.length).toBeGreaterThan(1);
expect(chunks[chunks.length - 1]?.toString()).toEndWith("BUN!");
expect(Buffer.concat(chunks).toString()).toBe("chunk ".repeat(4) + "BUN!");
