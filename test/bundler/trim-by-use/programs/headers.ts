const headers = new Headers({ "Content-Type": "text/plain", "X-One": "1" });
headers.append("x-one", "2");
headers.append("set-cookie", "a=1");
headers.append("set-cookie", "b=2");
headers.delete("content-type");
console.log(
  headers.get("X-ONE"),
  headers.has("content-type"),
  headers.getSetCookie().join("|"),
  [...headers.keys()].join(),
  JSON.stringify((headers as any).toJSON()),
  (headers as any).count,
);
console.log(headers, new Response("x", { headers }).headers.get("x-one"));
