import { expect, it } from "bun:test";
import net from "node:net";

it("handles trailing headers split across packets", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("7\r\n, world\r\n");
      socket.write("0\r\n");
      socket.uncork();
      setTimeout(() => {
        socket.write("X-Trail: ok\r\n");
        socket.write('X-Quoted: "quoted value with \\"escapes\\""\r\n\r\n');
        socket.end();
      }, 10);
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello, world");
});

it("handles trailing headers in a single packet", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.write("X-Trail: ok\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers with empty body", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("0\r\n");
      socket.write("X-Trail: ok\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("");
});

it("handles multiple trailing headers", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.write("X-Trail1: value1\r\n");
      socket.write("X-Trail2: value2\r\n");
      socket.write("X-Trail3: value3\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers with very long delay", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.uncork();
      setTimeout(() => {
        socket.write("X-Trail: ok\r\n\r\n");
        socket.end();
      }, 100);
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers with byte-by-byte transmission", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.uncork();

      const trailer = "X-Trail: ok\r\n\r\n";
      let i = 0;

      function writeNextByte() {
        if (i < trailer.length) {
          socket.write(trailer[i]);
          i++;
          setTimeout(writeNextByte, 5);
        } else {
          socket.end();
        }
      }

      setTimeout(writeNextByte, 10);
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers with malformed format (missing final CRLF)", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.write("X-Trail: ok\r\n"); // Missing final CRLF
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers with extremely large values", async () => {
  const largeValue = "x".repeat(16384); // 16KB value
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.write(`X-Large-Trail: ${largeValue}\r\n\r\n`);
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles connection close during trailing headers", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.write("X-Trail: partial\r\n");
      socket.end(); // Close connection abruptly
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers with multiple header lines", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.write("X-Trail-1: value1\r\n");
      socket.write("X-Trail-2: value2\r\n");
      socket.write("X-Trail-3: value3\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers with empty values", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");
      socket.write("X-Empty-Trail: \r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles delayed trailing headers", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");
      socket.write("5\r\nHello\r\n");
      socket.write("0\r\n");

      // Simulate delay before sending trailing headers
      setTimeout(() => {
        socket.write("X-Delayed-Trail: value\r\n\r\n");
        socket.end();
      }, 100);
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles trailing headers after the final chunk only", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // First chunk
      socket.write("5\r\nHello\r\n");

      // Second chunk
      socket.write("5\r\nWorld\r\n");

      // Final chunk with trailing headers
      socket.write("0\r\n");
      socket.write("X-Final-Trail: final\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("HelloWorld");
});

it("handles chunked extensions with empty extension", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Chunk with empty extension
      socket.write("5;\r\nHello\r\n");
      socket.write("0\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles chunked extensions with simple key", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Chunk with simple extension
      socket.write("5;foo\r\nHello\r\n");
      socket.write("0\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles chunked extensions with key-value pair", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Chunk with key-value extension
      socket.write("5;foo=bar\r\nHello\r\n");
      socket.write("0\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles chunked extensions with quoted value", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Chunk with quoted value extension
      socket.write('5;foo="bar baz"\r\nHello\r\n');
      socket.write("0\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("handles chunked extensions on multiple chunks", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // First chunk with extension
      socket.write("5;ext=1\r\nHello\r\n");

      // Second chunk with different extension
      socket.write("5;ext=2\r\nWorld\r\n");

      // Final chunk with extension
      socket.write("0;ext=final\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("HelloWorld");
});

it("handles chunked extensions with trailing headers", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Chunks with extensions
      socket.write("5;ext=first\r\nHello\r\n");
      socket.write("5;ext=second\r\nWorld\r\n");

      // Final chunk with extension and trailing headers
      socket.write("0;ext=final\r\n");
      socket.write("X-Trailer: value\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("HelloWorld");
});

it("handles chunked extensions with special characters", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Extension with special characters in quoted value
      socket.write('5;ext="!@#$%^&*()"\r\nHello\r\n');
      socket.write("0\r\n\r\n");
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  const address = await promise;
  const res = await fetch(`http://localhost:${address.port}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello");
});

it("proper error if missing zero-length chunk", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Valid chunk
      socket.write("5\r\nHello\r\n");

      // End the connection abruptly
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  try {
    const address = await promise;
    const response = await fetch(`http://localhost:${address.port}`);
    expect(response.status).toBe(200);
    await response.text();
    expect.unreachable();
  } catch (e) {
    expect(e?.code).toBe("ECONNRESET");
  }
});
it("proper error if missing data in middle of chunk extension", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Valid chunk
      socket.write("5\r\nHello\r\n");

      // Malformed chunk - missing CRLF after extension
      socket.write("5;ext=foo");

      // End the connection abruptly
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  try {
    const address = await promise;
    await fetch(`http://localhost:${address.port}`).then(res => res.text());
    expect.unreachable();
  } catch (e) {
    expect(e?.code).toBe("ECONNRESET");
  }
});

it("proper error if missing CRLF after chunk data", async () => {
  const { promise, resolve } = Promise.withResolvers();
  await using server = net
    .createServer(socket => {
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Type: text/plain\r\n");
      socket.write("Transfer-Encoding: chunked\r\n");
      socket.write("\r\n");

      // Valid chunk
      socket.write("5\r\nHello\r\n");

      // Malformed chunk - missing CRLF after chunk data
      socket.write("5\r\nWorldX");

      // End the connection abruptly
      socket.end();
    })
    .listen(0, "localhost", () => {
      resolve(server.address());
    });

  try {
    const address = await promise;
    await fetch(`http://localhost:${address.port}`).then(res => res.text());
    expect.unreachable();
  } catch (e) {
    expect(e?.code).toBe("InvalidHTTPResponse");
  }
});
