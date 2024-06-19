// String.prototype.repeat is really slow in debug builds.
const content = Buffer.alloc(3 * 15360000, "Bun").toString();

const server = Bun.serve({
  port: 0,
  fetch: async req => {
    const data = await req.formData();
    return new Response(data.get("name") === content ? "OK" : "NO");
  },
});

const formData = new FormData();
formData.append("name", content);
const result = await fetch(server.url, {
  method: "POST",
  body: formData,
}).then(res => res.text());

server.stop();

process.exit(result === "OK" ? 0 : 1);
