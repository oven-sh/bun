import { serve } from "bun";
import { describe, it, expect } from "bun:test";

const port = 3009;

async function testHeader(headerValue) {
  const ret = serve({
    fetch(req) {
      const hdr = req.headers.get("x-broken-string");
      console.log("Server got: ", Object.fromEntries(req.headers.entries()));
      return new Response(hdr);
    },
    port: port,
  });

  console.log("Original value", headerValue);
  console.log(
    "Original byte sequence:",
    new TextEncoder().encode(headerValue)
  );
  const res = await fetch(
    `http://localhost:${port}/`,
    {
      headers: {
        "x-broken-string": headerValue,
      },
    },
    { verbose: true }
  );

  ret.stop();
  return await res.text();
}

it("Headers should work", async () =>{
  const brokenString = "Header 1";
  expect(await testHeader(brokenString)).toBe(brokenString);
});

it("UTF8 headers should work, original", async () =>{
  const pageSource = await (await fetch("https://twitter.com")).text();
  const [, brokenString] = pageSource.match(/gt=([0-9]+);/);
  expect(await testHeader(brokenString)).toBe(brokenString);
});

it("UTF16 headers should work", async () =>{
  const brokenString = `❤️ Red Heart
              ✨ Sparkles
              🔥 Fire`;
  expect(await testHeader(brokenString)).toBe(brokenString);
});

