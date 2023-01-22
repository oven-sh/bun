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

//TODO: use a bun.sh SRV for testing
test("dns.resolveSrv (_test._tcp.test.socketify.dev)", (done) => {
  dns.resolveSrv("_test._tcp.test.socketify.dev", (err, results) => {
    expect(err).toBeNull();
    expect(results instanceof Array).toBe(true);
    expect(results[0].name).toBe("_dc-srv.130c90ab9de1._test._tcp.test.socketify.dev");
    expect(results[0].priority).toBe(50);
    expect(results[0].weight).toBe(50);
    expect(results[0].port).toBe(80);
    done(err);
  });
});

test("dns.resolveSrv (_test._tcp.invalid.localhost)", (done) => {
  dns.resolveSrv("_test._tcp.invalid.localhost", (err, results) => {
    expect(err).toBeTruthy();
    expect(results).toBeUndefined(true);
    done();
  });
});