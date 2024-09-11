import { expect, it } from "bun:test";
import { tls } from "harness";
import { connect, createServer } from "node:tls";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

it("should work with named pipes and tls", async () => {
  async function test(pipe_name: string) {
    const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers();
    const { promise: clientReceived, resolve: resolveClientReceived } = Promise.withResolvers();
    let client: ReturnType<typeof connect> | null = null;
    let server: ReturnType<typeof createServer> | null = null;
    try {
      server = createServer(tls, socket => {
        socket.on("data", data => {
          const message = data.toString();
          console.log(`Message received from client: ${message}`);
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

  await test(`\\\\.\\pipe\\test\\${randomUUID()}`);
  await test(`\\\\?\\pipe\\test\\${randomUUID()}`);
});
