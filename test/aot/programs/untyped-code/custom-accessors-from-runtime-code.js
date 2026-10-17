// Functions made at run time read accessors that the runtime implements natively (request.url, request.method, response.status ..), over and over, while the objects and their prototype chains change under them.
const lines = [];
const readers = Object.create(null);
const reader = name => (readers[name] ??= new Function("value", "return value." + name + ";"));
const show = value => (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value));
const say = (label, run) => {
  const seen = [];
  for (let turn = 0; turn < 6; turn++) {
    try {
      seen.push(show(run()));
    } catch (error) {
      seen.push("throws " + error.constructor.name);
    }
  }
  lines.push(label + ": " + seen.join(" "));
};
const get = new Request("http://localhost/one"), post = new Request("http://localhost/two?x=1", { method: "POST", body: "text" });
say("url", () => reader("url")(get) + " " + reader("url")(post));
say("method", () => reader("method")(get) + " " + reader("method")(post));
say("headers", () => reader("headers")(get));
say("the same headers", () => reader("headers")(get) === reader("headers")(get));
say("bodyUsed", () => reader("bodyUsed")(post));
const ok = new Response("body", { status: 201, statusText: "Made" });
say("status", () => reader("status")(ok) + " " + reader("statusText")(ok) + " " + reader("ok")(ok));
say("a request where a response was", () => reader("status")(get));
say("a response where a request was", () => reader("method")(ok));
say("what inherits from a request", () => reader("method")(Object.create(get)));
say("the prototype itself", () => reader("method")(Request.prototype));
say("a plain object", () => reader("method")({ method: "mine" }));
say("nothing", () => reader("method")(undefined));

class Mine extends Request {}
const mine = new Mine("http://localhost/mine");
say("a subclass", () => reader("method")(mine) + " " + reader("url")(mine));
Object.defineProperty(Mine.prototype, "method", { get() { return "overridden for " + this.url; }, configurable: true });
say("a subclass that overrides", () => reader("method")(mine));
delete Mine.prototype.method;
say("a subclass that no longer does", () => reader("method")(mine));
Object.defineProperty(Mine.prototype, "method", { value: "a value", configurable: true });
say("a subclass with a value", () => reader("method")(mine));
delete Mine.prototype.method;
Object.defineProperty(mine, "method", { value: "its own", configurable: true });
say("an own property", () => reader("method")(mine));
delete mine.method;
say("the own property is gone", () => reader("method")(mine));
Object.setPrototypeOf(mine, { method: "of another chain" });
say("another chain", () => reader("method")(mine));
Object.setPrototypeOf(mine, Mine.prototype);
say("the first chain again", () => reader("method")(mine));

const blob = new Blob(["abc"], { type: "text/plain" });
say("a blob", () => reader("size")(blob) + " " + reader("type")(blob));
say("a map's size where a blob's was", () => reader("size")(new Map([[1, 2]])));
const mixed = [get, post, ok, mine, { method: "plain" }, blob];
for (let round = 0; round < 4; round++) lines.push("in turn: " + mixed.map(value => show(reader("method")(value))).join(" "));

let total = 0;
for (let turn = 0; turn < 30000; turn++) {
  total += reader("url")(turn % 2 ? get : post).length + reader("method")(turn % 3 ? get : post).length + reader("status")(ok);
  if (turn % 10000 === 9999) Bun.gc(true);
}
lines.push("total " + total);
console.log(lines.join("\n"));
