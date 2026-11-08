import http from "node:http";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/redirect") return Response.redirect("/echo", 302);
    return Response.json({
      method: request.method,
      path: url.pathname,
      body: await request.text(),
      header: request.headers.get("x-sent"),
    });
  },
});
const origin = `http://127.0.0.1:${server.port}`;

const posted = await fetch(`${origin}/echo`, { method: "POST", body: "a body", headers: { "x-sent": "yes" } });
console.log(posted.status, JSON.stringify(await posted.json()));
const redirected = await fetch(`${origin}/redirect`);
console.log(redirected.redirected, new URL(redirected.url).pathname);
const streamed = await fetch(`${origin}/echo`, {
  method: "PUT",
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("in "));
      controller.enqueue(new TextEncoder().encode("pieces"));
      controller.close();
    },
  }),
});
console.log(((await streamed.json()) as { body: string }).body);
console.log(
  await new Promise<string>((resolve, reject) => {
    http
      .get(`${origin}/from-node`, response => {
        let text = "";
        response
          .setEncoding("utf8")
          .on("data", piece => (text += piece))
          .on("end", () => resolve(`${response.statusCode} ${JSON.parse(text).path}`));
      })
      .on("error", reject);
  }),
);
server.stop(true);
