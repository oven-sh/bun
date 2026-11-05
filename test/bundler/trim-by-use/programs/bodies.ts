import { tmpdir } from "node:os";
const blob = new Blob(["hello ", new Uint8Array([119, 111, 114, 108, 100])], { type: "text/plain" });
console.log(
  blob.size,
  blob.type,
  await blob.text(),
  await blob.slice(6).text(),
  (await blob.arrayBuffer()).byteLength,
  new File(["x"], "x.txt").name,
);
const request = new Request("http://example.com/a", {
  method: "POST",
  body: JSON.stringify({ a: 1 }),
  headers: { "x-a": "b" },
});
console.log(request.method, request.url, (await request.clone().json()).a, request.headers.get("x-a"));
const response = Response.json({ ok: true }, { status: 201 });
console.log(
  response.status,
  response.ok,
  await response.clone().text(),
  response.headers.get("content-type"),
  Response.redirect("http://x/", 302).status,
);
const path = tmpdir() + "/bodies-" + process.pid + ".txt";
console.log(
  await Bun.write(path, "written"),
  await Bun.file(path).text(),
  Bun.file(path).size,
  await Bun.file(path).exists(),
  Bun.file("a.json").type,
);
await Bun.file(path).delete();
console.log(
  await Bun.file(path).exists(),
  typeof Bun.stdin.size,
  Bun.stdout.constructor.name,
  Bun.embeddedFiles.length,
);
console.log(blob, request, response);
