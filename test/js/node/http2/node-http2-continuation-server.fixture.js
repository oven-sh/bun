/**
 * Node.js HTTP/2 server fixture for testing CONTINUATION frames.
 *
 * This server:
 * 1. Accepts requests with any number of headers
 * 2. Can respond with many headers (triggered by x-response-headers header)
 * 3. Can respond with large trailers (triggered by x-response-trailers header)
 */
const http2 = require("node:http2");

// Read TLS certs from args
const tlsCert = JSON.parse(process.argv[2]);

const server = http2.createSecureServer({
  key: tlsCert.key,
  cert: tlsCert.cert,
  // Allow up to 2000 header pairs (default is 128)
  maxHeaderListPairs: 2000,
  // Larger settings to avoid ENHANCE_YOUR_CALM
  settings: {
    maxHeaderListSize: 256 * 1024, // 256KB
  },
});

server.on("stream", (stream, headers) => {
  stream.on("error", err => {
    // Ignore stream errors in fixture - test will handle client-side
    console.error("Stream error:", err.message);
  });

  const path = headers[":path"] || "/";

  // Count how many headers we received (excluding pseudo-headers)
  const receivedHeaders = Object.keys(headers).filter(h => !h.startsWith(":")).length;

  // Check if client wants large response headers
  const numResponseHeaders = parseInt(headers["x-response-headers"] || "0", 10);

  // Check if client wants large trailers
  const numResponseTrailers = parseInt(headers["x-response-trailers"] || "0", 10);

  // Build response headers
  const responseHeaders = {
    ":status": 200,
    "content-type": "application/json",
  };

  // Add requested number of response headers
  for (let i = 0; i < numResponseHeaders; i++) {
    responseHeaders[`x-response-header-${i}`] = "R".repeat(150);
  }

  if (numResponseTrailers > 0) {
    // Send response with trailers
    stream.respond(responseHeaders, { waitForTrailers: true });

    stream.on("wantTrailers", () => {
      const trailers = {};
      for (let i = 0; i < numResponseTrailers; i++) {
        trailers[`x-trailer-${i}`] = "T".repeat(150);
      }
      stream.sendTrailers(trailers);
    });

    stream.end(
      JSON.stringify({
        receivedHeaders,
        responseHeaders: numResponseHeaders,
        responseTrailers: numResponseTrailers,
        path,
      }),
    );
  } else {
    // Normal response without trailers
    stream.respond(responseHeaders);
    stream.end(
      JSON.stringify({
        receivedHeaders,
        responseHeaders: numResponseHeaders,
        path,
      }),
    );
  }
});

server.on("error", err => {
  console.error("Server error:", err.message);
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  process.stdout.write(JSON.stringify({ port, address: "127.0.0.1" }));
});
