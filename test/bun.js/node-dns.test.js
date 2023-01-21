import { expect, test } from "bun:test";
import * as dns from "node:dns";

// TODO:
test("it exists", () => {
  expect(dns).toBeDefined();
  expect(dns.lookup).toBeDefined();
  expect(dns.lookupService).toBeDefined();
  expect(dns.resolve).toBeDefined();
  expect(dns.resolve4).toBeDefined();
  expect(dns.resolve6).toBeDefined();
});

test("dns.lookup (localhost)", (done) => {
  dns.lookup("localhost", (err, address, family) => {
    expect(err).toBeNull();
    if (family === 6) {
      expect(address).toBe("::1");
    } else {
      expect(address).toBe("127.0.0.1");
    }

    done(err);
  });
});

test("dns.lookup (example.com)", (done) => {
  dns.lookup("example.com", (err, address, family) => {
    expect(err).toBeNull();
    expect(typeof address).toBe("string");
    done(err);
  });
});

