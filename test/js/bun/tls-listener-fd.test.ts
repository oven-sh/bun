import { expect, test } from "bun:test";

test("TLS listener .fd does not crash", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: { data: () => {} },
    tls: { passphrase: "test" },
  });
  expect(typeof listener.fd).toBe("number");
  expect(listener.fd).toBeGreaterThan(0);
});
