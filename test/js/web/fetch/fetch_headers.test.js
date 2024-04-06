import { describe, it, expect, beforeAll, afterAll } from "bun:test";
let url = `http://localhost:0`;
let server;

describe("Headers", async () => {
  // Start up a single server and reuse it between tests
  beforeAll(() => {
    server = Bun.serve({
      fetch(req) {
        const hdr = req.headers.get("x-test");
        return new Response(hdr);
      },
      port: 0,
    });
    url = `http://${server.hostname}:${server.port}`;
  });
  afterAll(() => {
    server.stop(true);
  });

  it("Headers should work", async () => {
    expect(await fetchContent({ "x-test": "header 1" })).toBe("header 1");
  });

  it("Header names must be valid", async () => {
    expect(() => fetch(url, { headers: { "a\tb:c": "foo" } })).toThrow("Invalid header name: 'a\tb:c'");
    expect(() => fetch(url, { headers: { "❤️": "foo" } })).toThrow("Invalid header name: '❤️'");
  });

  it("Header values must be valid", async () => {
    expect(() => fetch(url, { headers: { "x-test": "\0" } })).toThrow("Header 'x-test' has invalid value: '\0'");
    expect(() => fetch(url, { headers: { "x-test": "❤️" } })).toThrow("Header 'x-test' has invalid value: '❤️'");
  });

  it("repro 1602", async () => {
    const origString = "😂1234".slice(3);

    var encoder = new TextEncoder();
    var decoder = new TextDecoder();
    const roundTripString = decoder.decode(encoder.encode(origString));

    expect(roundTripString).toBe(origString);

    // This one will pass
    expect(await fetchContent({ "x-test": roundTripString })).toBe(roundTripString);
    // This would hang
    expect(await fetchContent({ "x-test": origString })).toBe(origString);
  });

  describe("toJSON()", () => {
    it("should provide lowercase header names", () => {
      const headers1 = new Headers({ "X-Test": "yep", "Content-Type": "application/json" });
      expect(headers1.toJSON()).toEqual({ "x-test": "yep", "content-type": "application/json" });

      const headers2 = new Headers();
      headers2.append("X-Test", "yep");
      headers2.append("Content-Type", "application/json");
      expect(headers2.toJSON()).toEqual({ "x-test": "yep", "content-type": "application/json" });
    });
  });
});

async function fetchContent(headers) {
  const res = await fetch(url, { headers: headers }, { verbose: true });
  return await res.text();
}
