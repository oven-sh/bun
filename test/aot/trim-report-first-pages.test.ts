// What a Bun user writes on the first pages of the docs keeps what it uses and no more. Each of these once kept every built-in of the language (all of Intl, Temporal, WebAssembly, the interpreter:
// 17 to 21 MB under --trim), because one row of the table of built-ins said more than the host does.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function report(text: string) {
  using dir = tempDirWithBunTypes("aot-trim-report-first-pages", { "main.ts": text });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const prefix = "aot: trim: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  const nameOf = (line: string) => /\((?<name>[a-z0-9-]+)\): /.exec(line)?.groups?.name;
  return {
    first: lines[0] ?? stdout + stderr,
    locales: lines.find(line => line.startsWith("locales: ")),
    // By the names of compile.trim.allow.
    keepsOfTheLanguage: ["intl", "intl-segmenter", "temporal", "webassembly", "interpreter"].filter(name =>
      lines.some(line => line.startsWith("kept ") && nameOf(line) === name),
    ),
    // The error of a promise that native code rejects is in the hands of whoever catches it.
    escapes: lines
      .flatMap(line => /^uses (?<name>.+) \(escapes, so any member may be used\)$/.exec(line)?.groups?.name ?? [])
      .filter(name => name !== "Error.prototype"),
    exitCode,
  };
}
const tight = {
  first: "the compiler can see every API this program uses",
  locales: "locales: none",
  keepsOfTheLanguage: [],
  escapes: [],
  exitCode: 0,
};

describe.concurrent("keeps nothing of the language that it does not use", () => {
  test.each([
    ["Bun.serve with fetch", `Bun.serve({ port: 3000, fetch() { return new Response("hello"); } });`],
    [
      "Bun.serve with a function as a route",
      `Bun.serve({ port: 3000, routes: { "/": () => new Response("hello") } });`,
    ],
    ["parsed JSON, printed", `console.log(JSON.parse(process.argv[2]!));`],
    ["an error, printed", `console.error(new Error("x"));`],
    ["the headers of a request, printed", `console.log(new Request("http://localhost").headers);`],
    ["a request and a response, printed", `console.log(new Request("http://localhost"), new Response("a"));`],
    ["the text of a file", `console.log(await Bun.file("a.txt").text());`],
    ["the bytes of a file", `console.log((await Bun.file("a.txt").bytes()).length);`],
    ["whether a file exists", `console.log(await Bun.file("a.txt").exists());`],
    ["the size of a file", `console.log(Bun.file("a.txt").size);`],
    ["a part of a file", `console.log(await Bun.file("a.txt").slice(1, 3).text());`],
    [
      "a server that reads the method and a header",
      `Bun.serve({ port: 3000, fetch(request) { return new Response(request.method + request.headers.get("accept")); } });`,
    ],
    [
      "a server that reads the text of the request",
      `Bun.serve({ port: 3000, async fetch(request) { return new Response(await request.text()); } });`,
    ],
    [
      "Bun.serve with several routes and a fallback",
      `Bun.serve({ port: 3000, routes: { "/": () => new Response("home"), "/about": () => new Response("about") }, fetch: () => new Response("no", { status: 404 }) });`,
    ],
    [
      "a route that deletes a cookie",
      `Bun.serve({ port: 3000, routes: { "/": request => { request.cookies.delete("a"); return new Response("x"); } } });`,
    ],
  ])("%s", async (_, text) => {
    expect(await report(text)).toEqual(tight);
  });
  test("a route that is a Response", async () => {
    const found = await report(`Bun.serve({ port: 3000, routes: { "/": new Response("hello") } });`);
    expect(found).toEqual(tight);
  });
});

const reports = new Map<string, ReturnType<typeof report>>();
function reportOnce(text: string) {
  let once = reports.get(text);
  if (!once) reports.set(text, (once = report(text)));
  return once;
}

async function keepsNothing(text: string) {
  const { escapes, ...rest } = await reportOnce(text);
  const { escapes: none, ...expected } = tight;
  expect(rest).toEqual(expected);
}

// Something of the language is in unknown hands here, a prototype object or an error, and nothing more is kept for that.
describe.concurrent("keeps nothing of the language where one of its objects escapes", () => {
  test.each([
    ["a date, printed", `console.log(new Date());`],
    [
      "a route with a parameter",
      `Bun.serve({ port: 3000, routes: { "/users/:id": request => new Response(request.params.id) } });`,
    ],
    [
      "a server with an error handler",
      `Bun.serve({ port: 3000, fetch() { return new Response("a"); }, error(error) { return new Response(error.message, { status: 500 }); } });`,
    ],
  ])("%s", (_, text) => keepsNothing(text));
});

// The stream is in the hands of native code, which asks it for Symbol.asyncIterator; what a direct stream queues at the end of a tick brings the queue of ticks, and that is all.
// Each of these had 3,670 built-ins in unknown hands and kept 157 of 267 features: a member of ReadableStream.prototype without a row makes objects of any class.
describe.concurrent("a stream of the host brings what a stream needs", () => {
  const inServer = (handler: string) => `Bun.serve({ port: 3000, ${handler} });`;
  async function bringsLittle(text: string) {
    await keepsNothing(text);
    expect((await reportOnce(text)).escapes.length).toBeLessThan(20);
  }
  test.each([
    ["the body of the request, handed on", inServer(`fetch(request) { return new Response(request.body); }`)],
    [
      "the body of the request, chunk by chunk",
      inServer(
        `async fetch(request) { let length = 0; for await (const chunk of request.body!) length += chunk.length; return new Response(String(length)); }`,
      ),
    ],
    [
      "one branch of the body of the request",
      inServer(
        `fetch(request) { const [left, right] = request.body!.tee(); right.cancel(); return new Response(left); }`,
      ),
    ],
    [
      "the text of the body of the request",
      inServer(`async fetch(request) { return new Response(await request.body!.text()); }`),
    ],
    [
      "whether the body of the request is locked",
      inServer(`fetch(request) { return new Response(String(request.body!.locked)); }`),
    ],
    ["the stream of a file", inServer(`fetch() { return new Response(Bun.file("a.txt").stream()); }`)],
    [
      "a stream with a source as the body of the response",
      inServer(
        `fetch() { return new Response(new ReadableStream({ start(controller) { controller.enqueue("a"); controller.close(); } })); }`,
      ),
    ],
    [
      "a stream whose source encodes what it enqueues",
      inServer(
        `fetch() { const encoder = new TextEncoder(); return new Response(new ReadableStream({ pull(controller) { controller.enqueue(encoder.encode("data: a\\n\\n")); controller.close(); } })); }`,
      ),
    ],
    [
      "the readable end of a transform stream as the body of the response",
      inServer(`fetch() { const { readable } = new TransformStream(); return new Response(readable); }`),
    ],
    [
      "a writer that fills a transform stream",
      inServer(
        `fetch() { const { readable, writable } = new TransformStream(); const writer = writable.getWriter(); writer.write("a").then(() => writer.close()); return new Response(readable); }`,
      ),
    ],
    [
      "the body of the request piped into a transform stream",
      inServer(
        `fetch(request) { const { readable, writable } = new TransformStream(); request.body?.pipeTo(writable, { preventClose: true }); return new Response(readable); }`,
      ),
    ],
    [
      "the body of the request piped into a sink",
      inServer(
        `async fetch(request) { let length = 0; await request.body!.pipeTo(new WritableStream({ write(chunk) { length += chunk.length; } })); return new Response(String(length)); }`,
      ),
    ],
    [
      "the body of the request piped through a transformer",
      inServer(
        `fetch(request) { return new Response(request.body!.pipeThrough(new TransformStream({ transform(chunk, controller) { controller.enqueue(chunk); } }))); }`,
      ),
    ],
    [
      "the body of the request piped through a text decoder stream",
      inServer(`fetch(request) { return new Response(request.body!.pipeThrough(new TextDecoderStream())); }`),
    ],
    [
      "the body of the request piped through a compression stream",
      inServer(`fetch(request) { return new Response(request.body!.pipeThrough(new CompressionStream("gzip"))); }`),
    ],
    [
      "a reader of the body of the request",
      inServer(
        `async fetch(request) { const reader = request.body!.getReader(); const { done } = await reader.read(); reader.releaseLock(); return new Response(String(done)); }`,
      ),
    ],
  ])("%s", (_, text) => bringsLittle(text));
});

// A listener that throws is reported at the next tick: that brings the queue of ticks, and that is all. Each of these had 3,670 built-ins in unknown hands and kept 157 of 267 features:
// the warning that addEventListener() emits, and with it the standard streams, hung on every object of a class below EventTarget.
describe.concurrent("a signal that exists brings what a listener that throws needs", () => {
  const inServer = (handler: string) => `Bun.serve({ port: 3000, ${handler} });`;
  test.each([
    [
      "whether the signal of the request is aborted",
      inServer(`fetch(request) { return new Response(String(request.signal.aborted)); }`),
    ],
    [
      "a listener laid on the signal of the request",
      inServer(`fetch(request) { request.signal.onabort = () => {}; return new Response("x"); }`),
    ],
    [
      "the signal of the request, asked to throw",
      inServer(`fetch(request) { request.signal.throwIfAborted(); return new Response("x"); }`),
    ],
    [
      "a controller that aborts",
      `const controller = new AbortController(); controller.abort(); console.log(String(controller.signal.aborted));`,
    ],
    ["a signal with a time limit", `console.log(String(AbortSignal.timeout(10).aborted));`],
    ["a close event", `console.log(String(new CloseEvent("x").code));`],
    ["an exception of the host", `console.log(String(new DOMException("x").name));`],
    ["a custom event with a detail", `console.log(String(new CustomEvent("x", { detail: 1 }).detail));`],
    ["an error event with a message", `console.log(String(new ErrorEvent("x", { message: "y" }).message));`],
    ["a form", `const form = new FormData(); form.append("a", "b"); console.log(String(form.get("a")));`],
    ["a target of events", `console.log(typeof new EventTarget());`],
    ["an event that is dispatched", `console.log(String(new EventTarget().dispatchEvent(new Event("x"))));`],
  ])("%s", async (_, text) => {
    await keepsNothing(text);
    expect((await reportOnce(text)).escapes.length).toBeLessThan(20);
  });
});

// Whoever adds a listener brings the warning about too many of them (JSEventTarget.cpp), and what that needs of `process`.
describe.concurrent("a listener that is added brings the warning about too many listeners", () => {
  const inServer = (handler: string) => `Bun.serve({ port: 3000, ${handler} });`;
  test.each([
    [
      "a listener for the abort of the request",
      inServer(`fetch(request) { request.signal.addEventListener("abort", () => {}); return new Response("x"); }`),
    ],
    [
      "a stream that closes when the request is aborted",
      inServer(
        `fetch(request) { return new Response(new ReadableStream({ start(controller) { request.signal.addEventListener("abort", () => controller.close(), { once: true }); controller.enqueue("a"); } })); }`,
      ),
    ],
  ])("%s", async (_, text) => {
    expect((await reportOnce(text)).escapes.length).toBeLessThan(40);
  });
});

// A value nobody knows is converted to a string here: the body of a Response, a member of a form, the message of an error. `toString` is looked up by its name.
// Intl.Locale and the classes of Temporal have one too, but nobody has an instance in a program that names none of them.
describe.concurrent("keeps nothing of Intl and Temporal for a conversion to a string", () => {
  test.each([
    [
      "a server that answers the JSON that it was sent",
      `Bun.serve({ port: 3000, async fetch(request) { return Response.json(await request.json()); } });`,
    ],
    [
      "a request that is sent with a body and headers",
      `const response = await fetch("http://localhost:1", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } }); console.log(response.ok);`,
    ],
    ["a copy that is written as JSON", `console.log(JSON.stringify(structuredClone({ a: 1 })));`],
    ["the JSON of a file, written again", `console.log(JSON.stringify(await Bun.file("a.json").json()));`],
    [
      "an address that never escapes beside a print of what nobody knows",
      `const url = new URL("http://made.up/a"); console.log(JSON.parse("1")); console.log(String(url.pathname));`,
    ],
    [
      "a handler that prints the message of what it caught beside an address",
      `Bun.serve({ port: 3000, async fetch(request) { try { return new Response(new URL(request.url).pathname + (await request.json()).a); } catch (error) { console.log((error as Error).message); return new Response("bad", { status: 400 }); } } });`,
    ],
    [
      "a route that reads and sets a cookie",
      `Bun.serve({ port: 3000, routes: { "/": request => { request.cookies.set("a", "b"); return new Response(request.cookies.get("a")); } } });`,
    ],
  ])("%s", (_, text) => keepsNothing(text));
});

test("a server that reads a form", async () => {
  const { escapes, ...rest } = await report(
    `Bun.serve({ port: 3000, async fetch(request) { return new Response(String((await request.formData()).get("a"))); } });`,
  );
  expect(rest).toEqual({
    first: tight.first,
    locales: tight.locales,
    keepsOfTheLanguage: [],
    exitCode: 0,
  });
});

// The function that `format` returns takes no locale. It uses the locale of its formatter.
test("formatters keep the locales that they are made with", async () => {
  const { locales } = await report(
    `const numbers = new Intl.NumberFormat("de"); console.log(numbers.format(1234.5), [1, 2].map(new Intl.NumberFormat("fr").format), new Intl.DateTimeFormat("ja").format(0));`,
  );
  expect(locales).toBe("locales: de, fr, ja");
});

// Bun's library reads `constructor` from objects that nobody knows. That hands out no constructor of a formatter, which could then be given any locale.
test.failing(
  "a formatter keeps its locale beside code that reads `constructor` from what it is handed: every locale for ja",
  async () => {
    const beside = await report(
      `import { readFileSync } from "node:fs"; const day = new Intl.DateTimeFormat("ja"); const rows: { at: number }[] = JSON.parse(readFileSync(process.argv[2]!, "utf8")); for (const row of rows) console.log(day.format(row.at)); Promise.resolve(rows).then(r => console.log(r.length));`,
    );
    expect(beside.locales).toBe("locales: ja");
  },
);
test.failing("a formatter that is handed to such code keeps its locale: every locale for de", async () => {
  const escapedReport = await report(
    `import { promisify } from "node:util"; const count = new Intl.NumberFormat("de"); const later: any = promisify((x: any, done: any) => done(null, x)); later(count).then((x: any) => console.log(x.format(1)));`,
  );
  expect(escapedReport.locales).toBe("locales: de");
});
