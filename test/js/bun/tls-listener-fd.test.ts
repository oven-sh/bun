import { expect, test } from "bun:test";
import { tls } from "harness";

test("TLS listener .fd does not crash", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: { data: () => {} },
    tls,
  });
  expect(typeof listener.fd).toBe("number");
  expect(listener.fd).toBeGreaterThan(0);
});
