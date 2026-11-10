// What Bun.serve hands to a handler and takes back from it, made by hand: Request, Response, Headers, URL, streams
import { estimateShallowMemoryUsageOf } from "bun:jsc";
const request = new Request("http://localhost/users/7?page=2", {
  method: "POST",
  headers: { "content-type": "application/json", cookie: "a=1" },
  body: JSON.stringify({ title: "x" }),
});
console.log(
  request.method,
  request.url,
  new URL(request.url).pathname,
  request.headers.get("content-type"),
  request.headers.get("cookie"),
);
console.log(estimateShallowMemoryUsageOf(request) > 0, request.signal.aborted, request.bodyUsed, request.redirect);
const copy = request.clone();
console.log(await request.json(), await copy.text(), request.bodyUsed);
console.log(Bun.inspect(new Request("http://localhost/x", { headers: { a: "b" } })).split("\n").length > 1);
const again = new Request(new Request("http://localhost/y", { method: "PUT", body: "z" }), {
  headers: { "x-again": "1" },
});
console.log(again.method, again.url, again.headers.get("x-again"), await again.text());
const answer = Response.json({ ok: true }, { status: 201, headers: { "x-kind": "json" } });
console.log(answer.status, answer.statusText, answer.ok, answer.headers.get("x-kind"), await answer.text());
for (const status of [200, 204, 404, 418, 500])
  console.log(status, JSON.stringify(new Response(null, { status }).statusText));
const streamed = new Response(
  new ReadableStream({
    start(controller: any) {
      controller.enqueue("a");
      controller.enqueue("b");
      controller.close();
    },
  }),
);
console.log(await streamed.text());
const direct = new Response(
  new ReadableStream({
    type: "direct",
    async pull(controller: any) {
      controller.write("c");
      await controller.flush();
      controller.write("d");
      controller.close();
    },
  } as any),
);
console.log(await direct.text());
console.log(Response.redirect("http://localhost/z", 302).headers.get("location"), Response.error().type);
const aborter = new AbortController();
const aborted = new Request("http://localhost/a", { signal: aborter.signal });
aborter.abort(new Error("gone"));
console.log(aborted.signal.aborted, (aborted.signal.reason as Error).message);
for (let i = 0; i < 2000; i++) new Request("http://localhost/" + i, { method: "POST", body: "b" + i });
Bun.gc(true);
console.log("collected");
