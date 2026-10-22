function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function total(numbers: Iterable<number>): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

attempt("search parameters", () => {
  const params = new URLSearchParams("a=1&b=2&a=3");
  return [params.get("a"), params.getAll("a"), params.getAll("a").length, params.get("c"), params.has("b"), params.size, [...params.keys()], [...params.values()].map(v => v.length), [...params].length, params.toString()];
});
attempt("search parameters from an object, pairs and others", () => [new URLSearchParams({ a: "1" }).get("a"), new URLSearchParams([["b", "2"]]).get("b"), new URLSearchParams(new URLSearchParams("c=3")).get("c")]);
attempt("search parameters, changed", () => {
  const params = new URLSearchParams();
  params.append("z", "1");
  params.append("a", "2");
  params.set("z", "3");
  params.sort();
  const seen: string[] = [];
  params.forEach((value, key) => seen.push(key + value));
  params.delete("a");
  return [seen, params.toString()];
});
attempt("an address", () => {
  const url = new URL("https://user@h.example:8080/p/a?x=1#f");
  url.searchParams.append("y", "2");
  return [url.host, url.port.length, url.pathname.split("/"), url.searchParams.get("x"), url.search, url.hash, url.origin, URL.canParse("nope"), URL.parse("nope")];
});
attempt("headers", () => {
  const headers = new Headers({ "Content-Type": "text/plain", "X-A": "1" });
  headers.append("x-a", "2");
  headers.append("set-cookie", "a=1");
  headers.append("set-cookie", "b=2");
  return [headers.get("x-a"), headers.get("nothing"), headers.has("content-type"), [...headers.keys()], headers.getSetCookie(), headers.getSetCookie().length, [...headers].length];
});
attempt("headers from pairs and from headers", () => [new Headers([["a", "1"]]).get("a"), new Headers(new Headers({ b: "2" })).get("b")]);
attempt("form data", () => {
  const form = new FormData();
  form.append("a", "1");
  form.append("a", "2");
  form.set("b", "3");
  return [form.get("a"), form.getAll("a"), form.get("c"), form.has("b"), [...form.keys()], [...form.values()].length];
});
attempt("a response and a request", () => {
  const response = new Response("body", { status: 201, headers: { "x-a": "1" } });
  const request = new Request("http://h.example/p?q=1", { method: "POST", headers: { "x-b": "2" } });
  return [response.status + 1, response.ok, response.headers.get("x-a"), request.method, request.url, request.headers.get("x-b"), new URL(request.url).searchParams.get("q")];
});
attempt("an abort signal", () => {
  const controller = new AbortController();
  const before = controller.signal.aborted;
  const seen: string[] = [];
  controller.signal.addEventListener("abort", event => seen.push(event.type));
  controller.abort("reason");
  return [before, controller.signal.aborted, controller.signal.reason, seen, AbortSignal.abort().aborted];
});
attempt("an event handled by an object", () => {
  const target = new EventTarget();
  const handler = {
    count: 0,
    handleEvent(event: Event): void {
      this.count += event.type.length;
    },
  };
  target.addEventListener("ping", handler);
  target.dispatchEvent(new Event("ping"));
  target.dispatchEvent(new Event("ping"));
  return handler.count;
});

const blob = new Blob(["ab", new Uint8Array([99])], { type: "text/plain" });
const bytes = new Uint8Array(await blob.arrayBuffer());
console.log("a blob -> " + show([blob.size + 1, blob.type, await blob.text(), [...bytes], total(bytes), await blob.slice(1).text(), [...(await blob.bytes())].length]));
const response = new Response(JSON.stringify({ list: [1, 2] }));
const copy = response.clone();
console.log("bodies -> " + show([(await response.text()).length, total(new Uint8Array(await copy.arrayBuffer())) > 0, response.bodyUsed]));
const form = await new Response("a=1&b=2", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData();
console.log("a form from a body -> " + show([form.get("a"), form.get("b"), [...form.keys()]]));

export {};
