const text = "deflate ".repeat(3000);
const bytes = new TextEncoder().encode(text);
const gz = Bun.gzipSync(bytes, { library: "libdeflate", level: 12 });
console.log(
  "gzipSync libdeflate",
  gz.length,
  new TextDecoder().decode(Bun.gunzipSync(gz, { library: "libdeflate" })) === text,
);
const raw = Bun.deflateSync(bytes, { library: "libdeflate" });
console.log(
  "deflateSync libdeflate",
  raw.length,
  new TextDecoder().decode(Bun.inflateSync(raw, { library: "libdeflate" })) === text,
);
const echo = Bun.serve({
  port: 0,
  fetch: async (request: Request) =>
    new Response(`${request.headers.get("content-encoding")} ${(await request.bytes()).length}`),
});
console.log(
  await (await fetch(`http://localhost:${echo.port}/`, { method: "POST", body: text, compress: true } as any)).text(),
);
await echo.stop(true);
