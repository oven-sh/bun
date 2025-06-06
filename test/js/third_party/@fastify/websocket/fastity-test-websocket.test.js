import websocket from "@fastify/websocket";
import { expect, test } from "bun:test";
import Fastify from "fastify";

test("websocket", async () => {
  const fastify = Fastify({
    logger: false,
  });
  try {
    // Websocket
    fastify.register(websocket, {
      options: {
        server: fastify.server,
      },
    });

    // Health check routes
    fastify.get("/health", async () => ({ status: "ok" }));
    fastify.get("/healthz", async () => ({ status: "ok" }));
    const { promise, resolve } = Promise.withResolvers();
    let serverMessage = "";
    async function start() {
      try {
        fastify.register(instance => {
          instance.get("/websocket", { websocket: true }, (connection, request) => {
            connection.on("message", message => {
              serverMessage = message?.toString();
              connection.send("Hello, client!");
            });
          });
        });
        const address = await fastify.listen({ port: 0, host: "0.0.0.0" });

        console.info(`API listening on ${address}`);

        const ws = new WebSocket(`${address}/websocket`);
        ws.onopen = () => {
          ws.send("Hello, server!");
        };
        ws.onmessage = event => {
          resolve(event.data);
        };
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    }
    start();
    const message = await promise;
    expect(message).toBe("Hello, client!");
    expect(serverMessage).toBe("Hello, server!");
  } finally {
    fastify.close();
  }
});
