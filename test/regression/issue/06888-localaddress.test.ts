import { expect, test } from "bun:test";
import * as net from "net";
import * as os from "os";

test("TCP socket can bind to localAddress - IPv4", async () => {
  // Get a local IPv4 address
  const interfaces = os.networkInterfaces();
  let localIPv4: string | undefined;

  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        localIPv4 = addr.address;
        break;
      }
    }
    if (localIPv4) break;
  }

  // Skip test if no non-loopback IPv4 address found
  if (!localIPv4) {
    console.log("No non-loopback IPv4 address found, skipping test");
    return;
  }

  const server = net.createServer(socket => {
    const remoteAddr = socket.remoteAddress;
    socket.end(`Connected from ${remoteAddr}`);
  });

  await new Promise<void>(resolve => {
    server.listen(0, localIPv4, () => resolve());
  });

  const serverPort = (server.address() as net.AddressInfo).port;

  const clientPromise = new Promise<string>((resolve, reject) => {
    const client = net.createConnection({
      host: localIPv4,
      port: serverPort,
      localAddress: localIPv4,
    });

    client.on("connect", () => {
      expect(client.localAddress).toBe(localIPv4);
    });

    let data = "";
    client.on("data", chunk => {
      data += chunk.toString();
    });

    client.on("end", () => {
      resolve(data);
    });

    client.on("error", err => {
      reject(err);
    });
  });

  const response = await clientPromise;
  expect(response).toContain("Connected from");

  server.close();
});

test("TCP socket can bind to localAddress and localPort - IPv4", async () => {
  const server = net.createServer(socket => {
    const remoteAddr = socket.remoteAddress;
    const remotePort = socket.remotePort;
    socket.end(`Connected from ${remoteAddr}:${remotePort}`);
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const serverPort = (server.address() as net.AddressInfo).port;

  // Use a local port of 0 to let the system assign one
  const clientPromise = new Promise<{ data: string; localPort: number }>((resolve, reject) => {
    const client = net.createConnection({
      host: "127.0.0.1",
      port: serverPort,
      localAddress: "127.0.0.1",
      localPort: 0,
    });

    let localPort: number;
    client.on("connect", () => {
      expect(client.localAddress).toBe("127.0.0.1");
      localPort = client.localPort!;
      expect(localPort).toBeGreaterThan(0);
    });

    let data = "";
    client.on("data", chunk => {
      data += chunk.toString();
    });

    client.on("end", () => {
      resolve({ data, localPort });
    });

    client.on("error", err => {
      reject(err);
    });
  });

  const { data, localPort } = await clientPromise;
  expect(data).toContain("Connected from");
  expect(data).toContain(`:${localPort}`);

  server.close();
});

test("TCP socket can bind to localAddress - IPv6 loopback", async () => {
  const server = net.createServer(socket => {
    const remoteAddr = socket.remoteAddress;
    socket.end(`Connected from ${remoteAddr}`);
  });

  await new Promise<void>(resolve => {
    server.listen(0, "::1", () => resolve());
  });

  const serverPort = (server.address() as net.AddressInfo).port;

  const clientPromise = new Promise<string>((resolve, reject) => {
    const client = net.createConnection({
      host: "::1",
      port: serverPort,
      localAddress: "::1",
    });

    client.on("connect", () => {
      // IPv6 addresses might be normalized differently
      expect(client.localAddress).toContain(":");
    });

    let data = "";
    client.on("data", chunk => {
      data += chunk.toString();
    });

    client.on("end", () => {
      resolve(data);
    });

    client.on("error", err => {
      reject(err);
    });
  });

  const response = await clientPromise;
  expect(response).toContain("Connected from");

  server.close();
});

test("TCP socket without localAddress works normally", async () => {
  const server = net.createServer(socket => {
    socket.end("Hello");
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const serverPort = (server.address() as net.AddressInfo).port;

  const clientPromise = new Promise<string>((resolve, reject) => {
    const client = net.createConnection({
      host: "127.0.0.1",
      port: serverPort,
    });

    let data = "";
    client.on("data", chunk => {
      data += chunk.toString();
    });

    client.on("end", () => {
      resolve(data);
    });

    client.on("error", err => {
      reject(err);
    });
  });

  const response = await clientPromise;
  expect(response).toBe("Hello");

  server.close();
});
