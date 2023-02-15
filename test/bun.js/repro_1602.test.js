import { serve } from "bun";
import { describe, it, expect } from "bun:test";

const port = 3009;

async function testHeader(name, value) {

  console.log("Original value", value);
  console.log(
    "Original byte sequence:",
    new TextEncoder().encode(value)
  );
  var headers = {};
  headers[name] = value;

  return testHeaders(headers);
}

async function testHeaders(headers) {
  const ret = serve({
    fetch(req) {
      const hdr = req.headers.get("x-test");
      console.log("Server got: ", Object.fromEntries(req.headers.entries()));
      return new Response(hdr);
    },
    port: port,
  });

  const res = await fetch(
    `http://localhost:${port}/`,
    { headers: headers },
    { verbose: true }
  );

  ret.stop();
  return await res.text();
}

it("Headers should work", async () =>{
  expect(await testHeader("x-test", "header 1")).toBe("header 1");
});

it("Header names must be valid", async () =>{
  expect(() => testHeader("a\tb:c", "foo")).toThrow();
  expect(() => testHeader("❤️", "foo")).toThrow();
});

it("Header values must be valid", async () =>{
  expect(() => testHeader("x-test", "\0\0\0")).toThrow();
});

it("UTF16 headers should work", async () =>{
  const brokenString = `❤️ Red Heart
              ✨ Sparkles
              🔥 Fire`;
  expect(await testHeader("x-test", brokenString)).toBe(brokenString);
});


it("UTF8 headers should work, original", async () =>{
  const pageSource = await (await fetch("https://twitter.com")).text();
  const [, brokenString] = pageSource.match(/gt=([0-9]+);/);
  expect(await testHeader("x-test", brokenString)).toBe(brokenString);
});
