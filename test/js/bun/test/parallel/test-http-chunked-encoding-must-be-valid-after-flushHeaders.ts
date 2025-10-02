import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import { connect } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve, reject } = Promise.withResolvers();
await using server = http.createServer(async (req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain", "Transfer-Encoding": "chunked" });
  res.flushHeaders();
  // make sure headers are flushed
  await Bun.sleep(10);
  // send some chunks at once
  res.write("chunk 1");
  res.write("chunk 2");
  res.write("chunk 3");
  res.write("chunk 4");
  res.write("chunk 5");
  await Bun.sleep(10);
  // send some more chunk
  res.write("chunk 6");
  res.write("chunk 7");
  await Bun.sleep(10);
  // send the last chunk
  res.end();
});

server.listen(0);
await once(server, "listening");

const socket = connect(server.address().port, () => {
  socket.write(`GET / HTTP/1.1\r\nHost: localhost:${server.address().port}\r\nConnection: close\r\n\r\n`);
});

const chunks = [];
let received_headers = false;
socket.on("data", data => {
  if (!received_headers) {
    received_headers = true;
    const headers = data.toString("utf-8").split("\r\n");
    expect(headers[0]).toBe("HTTP/1.1 200 OK");
    expect(headers[1]).toBe("Content-Type: text/plain");
    expect(headers[2]).toBe("Transfer-Encoding: chunked");
    expect(headers[3].startsWith("Date:")).toBe(true);
    // empty line for end of headers aka flushHeaders works
    expect(headers[headers.length - 1]).toBe("");
    expect(headers[headers.length - 2]).toBe("");
  } else {
    chunks.push(data);
  }
});

function parseChunkedData(buffer) {
  let offset = 0;
  let result = Buffer.alloc(0);

  while (offset < buffer.length) {
    // Find the CRLF that terminates the chunk size line
    let lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;

    // Parse the chunk size (in hex)
    const chunkSizeHex = buffer.toString("ascii", offset, lineEnd);
    const chunkSize = parseInt(chunkSizeHex, 16);
    expect(isNaN(chunkSize)).toBe(false);
    // If chunk size is 0, we've reached the end
    if (chunkSize === 0) {
      // Skip the final CRLF after the 0-size chunk
      offset = lineEnd + 4;
      break;
    }

    // Move past the chunk size line's CRLF
    offset = lineEnd + 2;

    // Extract the chunk data
    const chunkData = buffer.slice(offset, offset + chunkSize);

    // Concatenate this chunk to our result
    result = Buffer.concat([result, chunkData]);

    // Move past this chunk's data and its terminating CRLF
    offset += chunkSize + 2;
  }

  return result;
}

socket.on("end", () => {
  try {
    const body = parseChunkedData(Buffer.concat(chunks));
    expect(body.toString("utf-8")).toBe("chunk 1chunk 2chunk 3chunk 4chunk 5chunk 6chunk 7");
    resolve();
  } catch (e) {
    reject(e);
  } finally {
    socket.end();
  }
});
await promise;
