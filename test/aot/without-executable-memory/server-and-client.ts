const server = Bun.serve({ port: 0, fetch(request: Request) { return new Response("hello " + new URL(request.url).pathname); } });
let got = "";
for (let i = 0; i < 200; i++) got = await (await fetch("http://127.0.0.1:" + server.port + "/" + i)).text();
server.stop(true);
console.log(got, Bun.hash("x") !== 0n, Bun.gunzipSync(Bun.gzipSync("abc")).length);
