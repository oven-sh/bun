import { expect, test } from "bun:test";
import dns from "node:dns";

test("dns.resolve callback parameters match Node.js", done => {
  dns.resolve("dns.google", (...args) => {
    // Should receive exactly 2 parameters: error and addresses array
    expect(args.length).toBe(2);
    expect(args[0]).toBe(null); // no error
    expect(Array.isArray(args[1])).toBe(true); // addresses should be array
    expect(args[1].every((addr: any) => typeof addr === "string")).toBe(true); // each address should be string
    done();
  });
});

test("dns.resolve with A record type callback parameters", done => {
  dns.resolve("dns.google", "A", (...args) => {
    expect(args.length).toBe(2);
    expect(args[0]).toBe(null);
    expect(Array.isArray(args[1])).toBe(true);
    expect(args[1].every((addr: any) => typeof addr === "string")).toBe(true);
    done();
  });
});

test("dns.resolve with AAAA record type callback parameters", done => {
  // Use a hostname that has AAAA records
  dns.resolve("google.com", "AAAA", (...args) => {
    expect(args.length).toBe(2);
    expect(args[0]).toBe(null);
    expect(Array.isArray(args[1])).toBe(true);
    expect(args[1].every((addr: any) => typeof addr === "string")).toBe(true);
    done();
  });
});

test("dns.promises.resolve returns array of strings", async () => {
  const result = await dns.promises.resolve("dns.google");
  expect(Array.isArray(result)).toBe(true);
  expect(result.every((addr: any) => typeof addr === "string")).toBe(true);
});

test("dns.promises.resolve with A record returns array of strings", async () => {
  const result = await dns.promises.resolve("dns.google", "A");
  expect(Array.isArray(result)).toBe(true);
  expect(result.every((addr: any) => typeof addr === "string")).toBe(true);
});

test("dns.promises.resolve with AAAA record returns array of strings", async () => {
  const result = await dns.promises.resolve("google.com", "AAAA");
  expect(Array.isArray(result)).toBe(true);
  expect(result.every((addr: any) => typeof addr === "string")).toBe(true);
});
