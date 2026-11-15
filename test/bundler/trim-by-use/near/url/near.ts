console.log(
  Bun.fileURLToPath("file:///C:/tmp/a%20b.txt"),
  import.meta.url.startsWith("file:"),
  encodeURIComponent("a b&c"),
  decodeURIComponent("a%20b"),
  new Request("http://example.com/a?b=1").url,
  new Response("x").url === "",
);
