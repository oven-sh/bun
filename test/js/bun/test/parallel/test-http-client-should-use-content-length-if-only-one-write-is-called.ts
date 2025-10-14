import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

await using server = http.createServer((req, res) => {
  if (req.headers["transfer-encoding"] === "chunked") {
    return res.writeHead(500).end();
  }
  res.writeHead(200);
  req.on("data", data => {
    res.write(data);
  });
  req.on("end", () => {
    res.end();
  });
});

await once(server.listen(0, "127.0.0.1"), "listening");

// Options for the HTTP request
const options = {
  hostname: "127.0.0.1", // Replace with the target server
  port: server.address().port,
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
    reject(new Error("Body should not be chunked"));
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
req.write("Hello World BUN!");
// End the request and signal no more data will be sent
req.end();

const chunks = await promise;
expect(chunks.length).toBe(1);
expect(chunks[0]?.toString()).toBe("Hello World BUN!");
expect(Buffer.concat(chunks).toString()).toBe("Hello World BUN!");
