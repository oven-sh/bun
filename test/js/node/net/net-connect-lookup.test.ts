import { expect, it } from "bun:test";
import { connect } from "node:net";

it("emits ERR_INVALID_IP_ADDRESS when a custom lookup yields a non-string address", async () => {
  // Node validates `typeof ip === "string"` before isIP(); an array like
  // ["127.0.0.1"] stringifies into a valid IP, so it must not connect.
  for (const family of [4, 6] as const) {
    const { promise, resolve, reject } = Promise.withResolvers<Error & { code?: string }>();
    const socket = connect({
      host: "example.com",
      port: 80,
      family,
      lookup: (_host, _options, callback) => {
        callback(null, ["127.0.0.1"] as unknown as string, family);
      },
    });
    socket.on("connect", () => reject(new Error("connected with an invalid lookup result")));
    socket.on("error", resolve);
    try {
      const error = await promise;
      expect(error.code).toBe("ERR_INVALID_IP_ADDRESS");
    } finally {
      socket.destroy();
    }
  }
});

it("passes a string address from a custom lookup through to the connection", async () => {
  // A loopback server observes the connection even though the hostname never
  // resolves, proving the lookup result is what gets connected to.
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {},
    },
  });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const socket = connect({
    host: "definitely-not-resolvable.example.invalid",
    port: server.port,
    family: 4,
    lookup: (_host, _options, callback) => {
      callback(null, "127.0.0.1", 4);
    },
  });
  socket.on("connect", () => resolve());
  socket.on("error", reject);
  try {
    await promise;
  } finally {
    socket.destroy();
  }
});
