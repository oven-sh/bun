import { expect, test } from "bun:test";

test("TLS listener .fd does not crash", () => {
  const listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: { data: () => {} },
    tls: { passphrase: "test" },
  });
  try {
    expect(typeof listener.fd).toBe("number");
    expect(listener.fd).toBeGreaterThan(0);
  } finally {
    listener.stop(true);
  }
});
