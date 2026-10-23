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
    ["a route that is a Response", `Bun.serve({ port: 3000, routes: { "/": new Response("hello") } });`],
    [
      "Bun.serve with several routes and a fallback",
      `Bun.serve({ port: 3000, routes: { "/": () => new Response("home"), "/about": () => new Response("about") }, fetch: () => new Response("no", { status: 404 }) });`,
    ],
  ])("%s", async (_, text) => {
    expect(await report(text)).toEqual(tight);
  });
});

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
  ])("%s", async (_, text) => {
    const { escapes, ...rest } = await report(text);
    const { escapes: none, ...expected } = tight;
    expect(rest).toEqual(expected);
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
      "a route that reads and sets a cookie",
      `Bun.serve({ port: 3000, routes: { "/": request => { request.cookies.set("a", "b"); return new Response(request.cookies.get("a")); } } });`,
    ],
    [
      "a request that is sent with a body and headers",
      `const response = await fetch("http://localhost:1", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } }); console.log(response.ok);`,
    ],
  ])("%s", async (_, text) => {
    const { escapes, ...rest } = await report(text);
    expect(rest).toEqual({
      first: tight.first,
      locales: tight.locales,
      keepsOfTheLanguage: [],
      exitCode: 0,
    });
  });
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
