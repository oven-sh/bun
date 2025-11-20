// https://github.com/oven-sh/bun/pull/24575
// Tests that socket._handle.fd property is available
import { expect, test } from "bun:test";
import net from "node:net";
import tls from "node:tls";

test("socket._handle.fd should be accessible on TCP sockets", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  let serverFd: number | undefined;
  let clientFd: number | undefined;

  const server = net.createServer(socket => {
    // Server-side socket should have _handle.fd
    expect(socket._handle).toBeDefined();
    expect(socket._handle.fd).toBeTypeOf("number");
    expect(socket._handle.fd).toBeGreaterThan(0);
    serverFd = socket._handle.fd;

    socket.end(`server fd: ${socket._handle.fd}`);
  });

  server.listen(0, "127.0.0.1", () => {
    const client = net.connect({
      host: "127.0.0.1",
      port: (server.address() as any).port,
    });

    client.on("connect", () => {
      // Client-side socket should have _handle.fd
      expect(client._handle).toBeDefined();
      expect(client._handle.fd).toBeTypeOf("number");
      expect(client._handle.fd).toBeGreaterThan(0);
      clientFd = client._handle.fd;
    });

    client.on("data", data => {
      const response = data.toString();
      expect(response).toStartWith("server fd: ");

      // Verify we got valid fds
      expect(serverFd).toBeTypeOf("number");
      expect(clientFd).toBeTypeOf("number");
      expect(serverFd).toBeGreaterThan(0);
      expect(clientFd).toBeGreaterThan(0);

      // Server and client should have different fds
      expect(serverFd).not.toBe(clientFd);

      server.close();
      resolve();
    });

    client.on("error", reject);
  });

  server.on("error", reject);

  await promise;
});

test("socket._handle.fd should remain consistent during connection lifetime", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const server = net.createServer(socket => {
    const initialFd = socket._handle.fd;

    // Send multiple messages to ensure fd doesn't change
    socket.write("message1\n");
    expect(socket._handle.fd).toBe(initialFd);

    socket.write("message2\n");
    expect(socket._handle.fd).toBe(initialFd);

    socket.end("message3\n");
    expect(socket._handle.fd).toBe(initialFd);
  });

  server.listen(0, "127.0.0.1", () => {
    const client = net.connect({
      host: "127.0.0.1",
      port: (server.address() as any).port,
    });

    let initialClientFd: number;
    let buffer = "";

    client.on("connect", () => {
      initialClientFd = client._handle.fd;
      expect(initialClientFd).toBeGreaterThan(0);
    });

    client.on("data", data => {
      buffer += data.toString();
      // Fd should remain consistent across multiple data events
      expect(client._handle.fd).toBe(initialClientFd);
    });

    client.on("end", () => {
      // Verify we received all messages
      expect(buffer).toBe("message1\nmessage2\nmessage3\n");
      server.close();
      resolve();
    });

    client.on("error", reject);
  });

  server.on("error", reject);

  await promise;
});

test("socket._handle.fd should be accessible on TLS sockets", async () => {
  const { tls: tlsCert } = await import("harness");
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  let serverFd: number | undefined;
  let clientFd: number | undefined;

  const server = tls.createServer(tlsCert, socket => {
    // Server-side TLS socket should have _handle.fd
    expect(socket._handle).toBeDefined();
    expect(socket._handle.fd).toBeTypeOf("number");
    // TLS sockets should have a valid fd (may be -1 on some platforms/states)
    expect(typeof socket._handle.fd).toBe("number");
    serverFd = socket._handle.fd;

    socket.end(`server fd: ${socket._handle.fd}`);
  });

  server.listen(0, "127.0.0.1", () => {
    const client = tls.connect({
      host: "127.0.0.1",
      port: (server.address() as any).port,
      rejectUnauthorized: false,
    });

    client.on("secureConnect", () => {
      // Client-side TLS socket should have _handle.fd
      expect(client._handle).toBeDefined();
      expect(client._handle.fd).toBeTypeOf("number");
      // TLS sockets should have a valid fd (may be -1 on some platforms/states)
      expect(typeof client._handle.fd).toBe("number");
      clientFd = client._handle.fd;
    });

    client.on("data", data => {
      const response = data.toString();
      expect(response).toMatch(/server fd: -?\d+/);

      // Verify we got valid fds (number type, even if -1)
      expect(serverFd).toBeTypeOf("number");
      expect(clientFd).toBeTypeOf("number");

      server.close();
      resolve();
    });

    client.on("error", reject);
  });

  server.on("error", reject);

  await promise;
});
