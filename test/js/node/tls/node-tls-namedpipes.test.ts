import { expect, it } from "bun:test";
import { expectMaxObjectTypeCount, isWindows, tls } from "harness";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { connect, createServer } from "node:tls";

it.if(isWindows)("should work with named pipes and tls", async () => {
  await expectMaxObjectTypeCount(expect, "TLSSocket", 0);
  async function test(pipe_name: string) {
    const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers();
    const { promise: clientReceived, resolve: resolveClientReceived } = Promise.withResolvers();
    let client: ReturnType<typeof connect> | null = null;
    let server: ReturnType<typeof createServer> | null = null;
    try {
      server = createServer(tls, socket => {
        socket.on("data", data => {
          const message = data.toString();
          socket.write("Goodbye World!");
          resolveMessageReceived(message);
        });
      });

      server.listen(pipe_name);
      await once(server, "listening");

      client = connect({ path: pipe_name, ca: tls.cert }).on("data", data => {
        const message = data.toString();
        resolveClientReceived(message);
      });

      client?.write("Hello World!");
      const message = await messageReceived;
      expect(message).toBe("Hello World!");
      const client_message = await clientReceived;
      expect(client_message).toBe("Goodbye World!");
    } finally {
      client?.destroy();
      server?.close();
    }
  }

  const batch: Promise<void>[] = [];

  for (let i = 0; i < 200; i++) {
    batch.push(test(`\\\\.\\pipe\\test\\${randomUUID()}`));
    batch.push(test(`\\\\?\\pipe\\test\\${randomUUID()}`));
    if (i % 50 === 0) {
      await Promise.all(batch);
      batch.length = 0;
    }
  }
  await Promise.all(batch);
  // Allow one extra straggler — server.close() resolves before the last
  // accepted socket's finalizer runs on Windows ARM64.
  await expectMaxObjectTypeCount(expect, "TLSSocket", 3);
});

it.if(isWindows)("should be able to upgrade a named pipe connection to TLS", async () => {
  await expectMaxObjectTypeCount(expect, "TLSSocket", 3);
  const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers();
  const { promise: clientReceived, resolve: resolveClientReceived } = Promise.withResolvers();
  let client: ReturnType<typeof net.connect> | ReturnType<typeof connect> | null = null;
  let server: ReturnType<typeof createServer> | null = null;
  async function test(pipe_name: string) {
    try {
      server = createServer(tls, socket => {
        socket.on("data", data => {
          const message = data.toString();
          socket.write("Goodbye World!");
          resolveMessageReceived(message);
        });
      });

      server.listen(pipe_name);
      await once(server, "listening");

      const nonTLSClient = net.connect(pipe_name);
      client = connect({ socket: nonTLSClient, ca: tls.cert }).on("data", data => {
        const message = data.toString();
        resolveClientReceived(message);
      });
      await once(client, "secureConnect");
      client?.write("Hello World!");
      const message = await messageReceived;
      expect(message).toBe("Hello World!");
      const client_message = await clientReceived;
      expect(client_message).toBe("Goodbye World!");
    } finally {
      client?.destroy();
      server?.close();
    }
  }
  await test(`\\\\.\\pipe\\test\\${randomUUID()}`);
  await expectMaxObjectTypeCount(expect, "TLSSocket", 3);
});

// https://github.com/oven-sh/bun/issues/32242
it.if(isWindows)("named-pipe TLS upgrade does not re-emit bytes on the original socket", async () => {
  const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers<string>();
  const { promise: clientReceived, resolve: resolveClientReceived } = Promise.withResolvers<string>();
  const { promise: done, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();

  let client: ReturnType<typeof connect> | null = null;
  let nonTLSClient: ReturnType<typeof net.connect> | null = null;
  let server: ReturnType<typeof createServer> | null = null;

  const leakedToOriginal: Buffer[] = [];

  const pipe_name = `\\\\.\\pipe\\test\\${randomUUID()}`;
  try {
    server = createServer(tls, socket => {
      socket.on("error", rejectDone);
      socket.on("data", data => {
        socket.write("Goodbye World!");
        resolveMessageReceived(data.toString());
      });
    });
    server.on("error", rejectDone);

    server.listen(pipe_name);
    await once(server, "listening");

    nonTLSClient = net.connect(pipe_name);
    nonTLSClient.on("error", rejectDone);
    nonTLSClient.on("data", chunk => {
      leakedToOriginal.push(chunk);
    });

    client = connect({ socket: nonTLSClient, ca: tls.cert });
    client.on("error", rejectDone);
    client.on("data", data => {
      resolveClientReceived(data.toString());
    });

    await Promise.race([once(client, "secureConnect"), done]);
    client.write("Hello World!");

    expect(await Promise.race([messageReceived, done])).toBe("Hello World!");
    expect(await Promise.race([clientReceived, done])).toBe("Goodbye World!");

    expect(Buffer.concat(leakedToOriginal).length).toBe(0);
    resolveDone();
    await done;
  } finally {
    client?.destroy();
    nonTLSClient?.destroy();
    server?.close();
  }
});
