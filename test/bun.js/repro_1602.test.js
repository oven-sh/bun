import { describe, it, expect, beforeAll, afterAll } from "bun:test";
const port = 3009;
const url = `http://localhost:${port}`;
let server;

describe("Headers", async () => {
  // Start up a single server and reuse it between tests
  beforeAll(() => {
    server = Bun.serve({
      fetch(req) {
        const hdr = req.headers.get("x-test");
        console.log("Server got: ", Object.fromEntries(req.headers.entries()));
        return new Response(hdr);
      },
      port: port,
    });
  });
  afterAll(() => {
    server.stop();
  });

  it("Headers should work", async () => {
    expect(await fetchContent({"x-test": "header 1"})).toBe("header 1");
  });

  it("Header names must be valid", async () => {
    expect(() => fetch(url, {headers: {"a\tb:c": "foo" }})).toThrow("Invalid header name: 'a\tb:c'");
    expect(() => fetch(url, {headers: {"❤️": "foo" }})).toThrow("Type error");
  });

  it("Header values must be valid", async () => {
    //expect(() => fetchContent({"x-test": "❤️" })).toThrow("Header 'x-test' has invalid value: '❤️'");
    expect(() => fetch(url, {headers: {"x-test": "❤️" }})).toThrow("Type error");
  });

  it("repro 1602", async () => {
    const origString = "😂1234".slice(3);

    var encoder = new TextEncoder();
    var decoder = new TextDecoder();
    const roundTripString = decoder.decode(encoder.encode(origString));
    console.log("origString = ", origString);
    console.log("encoded = ", encoder.encode(origString));

    expect(roundTripString).toBe(origString);

    // This one will pass
    expect(await fetchContent({"x-test": roundTripString})).toBe(roundTripString);
    // This will hang
    expect(await fetchContent({"x-test": origString})).toBe(origString);
  });
});

async function fetchContent(headers) {
  const res = await fetch(
    url,
    { headers: headers },
    { verbose: true }
  );
  console.log(res.status);
  return await res.text();
}
