import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { Socket } from "node:net";

test("http.Server.getConnections tracks active connections", async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address is not valid");
  }

  // Check initial connection count
  const initialCount = await new Promise<number>((resolve, reject) => {
    server.getConnections((err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
  expect(initialCount).toBe(0);

  // Create a connection
  const client1 = new Socket();
  await new Promise<void>((resolve, reject) => {
    client1.connect(address.port, "127.0.0.1", () => {
      resolve();
    });
    client1.on("error", reject);
  });

  // Write a simple HTTP request
  client1.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

  // Wait a bit for the connection to be established
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check connection count after first connection
  const countAfterFirst = await new Promise<number>((resolve, reject) => {
    server.getConnections((err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
  expect(countAfterFirst).toBe(1);

  // Create another connection
  const client2 = new Socket();
  await new Promise<void>((resolve, reject) => {
    client2.connect(address.port, "127.0.0.1", () => {
      resolve();
    });
    client2.on("error", reject);
  });

  client2.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");

  await new Promise(resolve => setTimeout(resolve, 100));

  // Check connection count with two connections
  const countWithTwo = await new Promise<number>((resolve, reject) => {
    server.getConnections((err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
  expect(countWithTwo).toBe(2);

  // Close first connection
  client1.end();
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check connection count after closing one
  const countAfterClosingOne = await new Promise<number>((resolve, reject) => {
    server.getConnections((err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
  expect(countAfterClosingOne).toBe(1);

  // Close second connection
  client2.end();
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check connection count after closing all
  const finalCount = await new Promise<number>((resolve, reject) => {
    server.getConnections((err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
  expect(finalCount).toBe(0);

  // Close the server
  await new Promise<void>((resolve, reject) => {
    server.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
});

test("http.Server.getConnections returns 0 when server is closed", async () => {
  const server = createServer((req, res) => {
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => {
      resolve();
    });
  });

  // Close the server immediately
  await new Promise<void>((resolve, reject) => {
    server.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Check connection count on closed server
  const count = await new Promise<number>((resolve, reject) => {
    server.getConnections((err, count) => {
      if (err) reject(err);
      else resolve(count);
    });
  });
  expect(count).toBe(0);
});

test("http.Server.getConnections throws if callback is not a function", async () => {
  const server = createServer();

  await new Promise<void>(resolve => {
    server.listen(0, () => {
      resolve();
    });
  });

  // Should throw for undefined
  expect(() => {
    (server as any).getConnections();
  }).toThrow('The "callback" argument must be of type function');

  // Should throw for null
  expect(() => {
    (server as any).getConnections(null);
  }).toThrow('The "callback" argument must be of type function');

  // Should throw for non-function
  expect(() => {
    (server as any).getConnections(123);
  }).toThrow('The "callback" argument must be of type function');

  await new Promise<void>((resolve, reject) => {
    server.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
});
