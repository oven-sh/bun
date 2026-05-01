import { expect, test } from "bun:test";
import { once } from "events";
import { createServer, request } from "http";
import { AddressInfo, connect, Server } from "net";

const fixture = "node-http-transfer-encoding-fixture.ts";
test(`should not duplicate transfer-encoding header in request`, async () => {
  const { resolve, promise } = Promise.withResolvers();
  const tcpServer = new Server();
  tcpServer.listen(0, "127.0.0.1");

  await once(tcpServer, "listening");

  tcpServer.on("connection", async socket => {
    const requestHeader = await once(socket, "data").then(data => data.toString());
    queueMicrotask(() => {
      socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.end(resolve);
    });

    const httpHeadersArray = requestHeader
      .split("\r\n")
      .slice(1) // Skip the first line (HTTP method line)
      .map(line => line.trim())
      .filter((_, index, arr) => index < arr.indexOf(""))
      .reduce(
        (headers, line) => {
          const [key, value] = line.split(/\s*:\s*/);
          return [...headers, { [key.toLowerCase()]: value }];
        },
        [] as { [key: string]: string }[],
      );
    const transferEncodingHeaders = httpHeadersArray.filter(header => header["transfer-encoding"]);
    if (transferEncodingHeaders.length > 1) {
      throw new Error(`Duplicate 'transfer-encoding' header found: ${JSON.stringify(transferEncodingHeaders)}`);
    }
  });

  const serverAddress = tcpServer.address() as AddressInfo;
  const chunkedRequest = request({
    host: "localhost",
    port: serverAddress.port,
    path: "/",
    method: "PUT",
    agent: false,
    headers: {
      "transfer-encoding": "chunked",
    },
  });

  // Requires multiple chunks to trigger streaming behavior
  chunkedRequest.write("Hello, World!");
  chunkedRequest.end("Goodbye, World!");

  return promise;
});

test("should not duplicate transfer-encoding header in response when explicitly set", async () => {
  await using server = createServer((req, res) => {
    res.writeHead(200, { "Transfer-Encoding": "chunked" });
    res.write("Hello, World!");
    res.end("Goodbye, World!");
  });

  await once(server.listen(0, "127.0.0.1"), "listening");

  const { port } = server.address() as AddressInfo;

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1", () => {
    socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
  });

  let rawResponse = "";
  socket.on("data", (chunk: Buffer) => {
    rawResponse += chunk.toString();
  });
  socket.on("end", () => resolve(rawResponse));
  socket.on("error", reject);

  const response = await promise;
  const headerSection = response.split("\r\n\r\n")[0];
  const headerLines = headerSection
    .split("\r\n")
    .slice(1) // Skip status line
    .filter(line => line.length > 0);

  const transferEncodingHeaders = headerLines.filter(line => line.toLowerCase().startsWith("transfer-encoding:"));

  expect(transferEncodingHeaders).toHaveLength(1);

  // Verify the body content is correctly delivered via chunked encoding
  const bodySection = response.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  expect(bodySection).toContain("Hello, World!");
  expect(bodySection).toContain("Goodbye, World!");
});
