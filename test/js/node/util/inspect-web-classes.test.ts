// The text that Node.js v26.3.0 prints for the classes with native state. `node --test` passes this file too.
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { Console } from "node:console";
import { X509Certificate } from "node:crypto";
import { BlockList, SocketAddress } from "node:net";
import { Writable } from "node:stream";
import { describe, test } from "node:test";
import { format, inspect, stripVTControlCharacters } from "node:util";
import { Worker } from "node:worker_threads";

const isBun = typeof process.versions.bun === "string";
const custom = Symbol.for("nodejs.util.inspect.custom");

/** The text in Node.js and the text in Bun, and why they are not the same. */
const differs = (node: string, bun: string, why: string) => {
  assert.ok(why.length > 0);
  return isBun ? bun : node;
};

/** What `fn` returns when that is a string, else the kind of value or the error. */
const outcome = (fn: () => unknown) => {
  try {
    const value = fn();
    return typeof value === "string" ? value : `(returns ${value === null ? "null" : typeof value})`;
  } catch (error: any) {
    return `${error.name}${error.code ? ` [${error.code}]` : ""}: ${error.message}`;
  }
};

function onTimeout() {}
const make = {
  Headers: () => new Headers({ "x-request-id": "abc123" }),
  Response: () => new Response(null, { status: 404, statusText: "Not Found", headers: { "x-request-id": "abc123" } }),
  Request: () => new Request("http://example.com/users?id=7", { method: "POST", headers: { accept: "text/html" } }),
  Blob: () => new Blob(["hello"], { type: "text/csv" }),
  File: () => new File(["hello"], "report.csv", { type: "text/csv", lastModified: 5 }),
  FormData: () => {
    const form = new FormData();
    form.append("username", "john_doe");
    form.append("email", "john@example.com");
    return form;
  },
  AbortSignal: () => AbortSignal.abort(),
  AbortController: () => new AbortController(),
  Event: () => new Event("ping", { cancelable: true }),
  TextDecoder: () => new TextDecoder("utf-16le", { fatal: true }),
};

const views = (value: unknown) => ({
  "text": inspect(value),
  "past the depth limit": inspect({ it: value }, { depth: 0 }),
  "three levels deep": inspect({ a: { b: { c: value } } }),
  "%s": format("%s", value),
});

const responseText = [
  "Response {",
  "  status: 404,",
  "  statusText: 'Not Found',",
  "  headers: Headers { 'x-request-id': 'abc123' },",
  "  body: null,",
  "  bodyUsed: false,",
  "  ok: false,",
  "  redirected: false,",
  "  type: 'default',",
  "  url: ''",
  "}",
];
const indented = (lines: string[], by: string) => lines.map(line => by + line).join("\n");

// Bun's Request holds other values than undici's, and the method prints what the getters give.
const requestWhy =
  "Bun's Request has referrer '' and credentials 'include', and has no keepalive and no navigation flags";
const requestText = {
  node: [
    "Request {",
    "  method: 'POST',",
    "  url: 'http://example.com/users?id=7',",
    "  headers: Headers { accept: 'text/html' },",
    "  destination: '',",
    "  referrer: 'about:client',",
    "  referrerPolicy: '',",
    "  mode: 'cors',",
    "  credentials: 'same-origin',",
    "  cache: 'default',",
    "  redirect: 'follow',",
    "  integrity: '',",
    "  keepalive: false,",
    "  isReloadNavigation: false,",
    "  isHistoryNavigation: false,",
  ],
  bun: [
    "Request {",
    "  method: 'POST',",
    "  url: 'http://example.com/users?id=7',",
    "  headers: Headers { accept: 'text/html' },",
    "  destination: '',",
    "  referrer: '',",
    "  referrerPolicy: '',",
    "  mode: 'cors',",
    "  credentials: 'include',",
    "  cache: 'default',",
    "  redirect: 'follow',",
    "  integrity: '',",
  ],
};
const requestLines = (signal: string) => {
  const tail = [`  signal: ${signal}`, "}"];
  return differs([...requestText.node, ...tail].join("\n"), [...requestText.bun, ...tail].join("\n"), requestWhy).split(
    "\n",
  );
};

describe("the text of each class", () => {
  test("Headers", () => {
    assert.deepStrictEqual(views(make.Headers()), {
      "text": "Headers { 'x-request-id': 'abc123' }",
      "past the depth limit": "{ it: Headers { 'x-request-id': 'abc123' } }",
      "three levels deep": "{ a: { b: { c: Headers { 'x-request-id': 'abc123' } } } }",
      "%s": "Headers { 'x-request-id': 'abc123' }",
    });
  });

  test("Headers: the values of a repeated name are one string, for set-cookie too", () => {
    const headers = new Headers();
    headers.append("x-a", "1");
    headers.append("x-a", "2");
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    assert.deepStrictEqual(
      [inspect(headers), inspect(new Headers()), inspect(new Headers({ "0": "zero", "a": "1" }))],
      [
        differs(
          "Headers { 'x-a': '1, 2', 'set-cookie': 'a=1, b=2' }",
          "Headers { 'set-cookie': 'a=1, b=2', 'x-a': '1, 2' }",
          "the order is the one that Bun stores the names in",
        ),
        "Headers {}",
        "Headers { '0': 'zero', a: '1' }",
      ],
    );
  });

  test("Response", () => {
    const value = make.Response();
    assert.deepStrictEqual(
      {
        ...views(value),
        "depth null": inspect(value, { depth: null }),
        "breakLength Infinity": inspect(value, { breakLength: Infinity }),
        "compact false": inspect(value, { compact: false }),
      },
      {
        "text": responseText.join("\n"),
        "past the depth limit": `{\n${indented(responseText, "  ").replace("  Response", "  it: Response")}\n}`,
        "three levels deep":
          "{\n  a: {\n    b: {\n" +
          indented(responseText, "      ").replace("      Response", "      c: Response") +
          "\n    }\n  }\n}",
        "%s": responseText.join("\n"),
        "depth null": responseText.join("\n"),
        "breakLength Infinity":
          "Response { status: 404, statusText: 'Not Found', headers: Headers { 'x-request-id': 'abc123' }, " +
          "body: null, bodyUsed: false, ok: false, redirected: false, type: 'default', url: '' }",
        "compact false": responseText
          .join("\n")
          .replace("Headers { 'x-request-id': 'abc123' }", "Headers {\n    'x-request-id': 'abc123'\n  }"),
      },
    );
  });

  test("Request", () => {
    const full = requestLines("AbortSignal { aborted: false }");
    const nested = requestLines("[AbortSignal]");
    assert.deepStrictEqual(views(make.Request()), {
      "text": full.join("\n"),
      "past the depth limit": `{\n${indented(nested, "  ").replace("  Request", "  it: Request")}\n}`,
      "three levels deep":
        "{\n  a: {\n    b: {\n" +
        indented(full, "      ").replace("      Request", "      c: Request") +
        "\n    }\n  }\n}",
      "%s": nested.join("\n"),
    });
  });

  test("Blob", () => {
    assert.deepStrictEqual(views(make.Blob()), {
      "text": "Blob { size: 5, type: 'text/csv' }",
      "past the depth limit": "{ it: [Blob] }",
      "three levels deep": "{ a: { b: { c: [Blob] } } }",
      "%s": "Blob [Object]",
    });
  });

  test("File", () => {
    assert.deepStrictEqual(views(make.File()), {
      "text": "File { size: 5, type: 'text/csv', name: 'report.csv', lastModified: 5 }",
      "past the depth limit": "{ it: [File] }",
      "three levels deep": "{ a: { b: { c: [File] } } }",
      "%s": "File [Object]",
    });
  });

  test("FormData", () => {
    const value = make.FormData();
    const lines = "FormData {\n  username: 'john_doe',\n  email: 'john@example.com'\n}";
    const nested = (indent: string) => lines.replaceAll("\n", `\n${indent}`);
    assert.deepStrictEqual(
      { ...views(value), "breakLength Infinity": inspect(value, { breakLength: Infinity }) },
      {
        "text": lines,
        "past the depth limit": `{\n  it: ${nested("  ")}\n}`,
        "three levels deep": `{\n  a: {\n    b: {\n      c: ${nested("      ")}\n    }\n  }\n}`,
        "%s": lines,
        "breakLength Infinity": "FormData { username: 'john_doe', email: 'john@example.com' }",
      },
    );
  });

  test("FormData: the values of a repeated name, and no entries", () => {
    const form = new FormData();
    form.append("a", "1");
    const one = inspect(form);
    form.append("a", "2");
    // undici starts an array only when the value the name has is truthy.
    form.append("b", "");
    form.append("b", "3");
    assert.deepStrictEqual(
      [one, inspect(form), inspect(new FormData())],
      ["FormData { a: '1' }", "FormData { a: [ '1', '2' ], b: '3' }", "FormData {}"],
    );
  });

  test("FormData: four values of a name, and the names __proto__ and 0", () => {
    const form = new FormData();
    for (const value of ["1", "", "3", "4"]) form.append("a", value);
    form.append("__proto__", "p");
    form.append("0", "zero");
    form.append("0", "one");
    assert.strictEqual(
      inspect(form),
      "FormData {\n  '0': [ 'zero', 'one' ],\n  a: [ '1', '', '3', '4' ],\n  ['__proto__']: 'p'\n}",
    );
  });

  test("FormData: a File entry", () => {
    const form = new FormData();
    form.append("doc", new File(["hello"], "report.csv", { type: "application/pdf", lastModified: 5 }));
    assert.strictEqual(
      inspect(form, { breakLength: Infinity }),
      "FormData { doc: File { size: 5, type: 'application/pdf', name: 'report.csv', lastModified: 5 } }",
    );
  });

  test("AbortSignal", () => {
    assert.deepStrictEqual(views(make.AbortSignal()), {
      "text": "AbortSignal { aborted: true }",
      "past the depth limit": "{ it: [AbortSignal] }",
      "three levels deep": "{ a: { b: { c: [AbortSignal] } } }",
      "%s": "AbortSignal [Object]",
    });
    assert.deepStrictEqual(
      [inspect(AbortSignal.timeout(100_000)), inspect(AbortSignal.any([]))],
      ["AbortSignal { aborted: false }", "AbortSignal { aborted: false }"],
    );
  });

  test("AbortController", () => {
    assert.deepStrictEqual(views(make.AbortController()), {
      "text": "AbortController { signal: AbortSignal { aborted: false } }",
      "past the depth limit": "{ it: AbortController {} }",
      "three levels deep": "{ a: { b: { c: AbortController {} } } }",
      "%s": "AbortController [Object]",
    });
  });

  test("Event", () => {
    const value = make.Event();
    // The time is 0 in Bun, so the test takes it from the event.
    const fields = { type: "ping", defaultPrevented: false, cancelable: true, timeStamp: value.timeStamp };
    assert.deepStrictEqual(views(value), {
      "text": `Event ${inspect(fields)}`,
      "past the depth limit": "{ it: Event }",
      "three levels deep": "{ a: { b: { c: Event } } }",
      "%s": "Event [Object]",
    });
    value.preventDefault();
    assert.strictEqual(inspect(value), `Event ${inspect({ ...fields, defaultPrevented: true })}`);
  });

  test("TextDecoder", () => {
    assert.deepStrictEqual(views(make.TextDecoder()), {
      "text": "TextDecoder { encoding: 'utf-16le', fatal: true, ignoreBOM: false }",
      "past the depth limit": "{ it: [TextDecoder] }",
      "three levels deep": "{ a: { b: { c: [TextDecoder] } } }",
      // The method prints its fields with default options, so a depth of 0 does not cut them.
      "%s": "TextDecoder { encoding: 'utf-16le', fatal: true, ignoreBOM: false }",
    });
  });

  test("Timeout", () => {
    const timeout = setTimeout(onTimeout, 50);
    const interval = setInterval(onTimeout, 70);
    try {
      const why = "Bun stores five of node's fields of a timer";
      const nodeOnly = /^  (_idlePrev|_idleNext|_timerArgs|Symbol\(\w+\)): /;
      // The fields are what the properties of the timer give.
      const expected = (value: any) => [
        "Timeout {",
        `  _idleTimeout: ${value._idleTimeout},`,
        `  _idleStart: ${value._idleStart},`,
        `  _onTimeout: ${inspect(value._onTimeout, { depth: 0 })},`,
        `  _repeat: ${value._repeat},`,
        differs("  _destroyed: false,", "  _destroyed: false", why),
        "}",
      ];
      const lines = (value: NodeJS.Timeout) =>
        inspect(value)
          .split("\n")
          .filter(line => !nodeOnly.test(line));
      assert.deepStrictEqual([lines(timeout), lines(interval)], [expected(timeout), expected(interval)]);
      assert.deepStrictEqual(
        [(timeout as any)._idleTimeout, (interval as any)._repeat, (timeout as any)._repeat],
        [50, 70, null],
      );
      // The method prints the timer one level deep at any depth.
      assert.strictEqual(inspect({ it: timeout }, { depth: 0 }).includes("_idleTimeout: 50"), true);
    } finally {
      clearTimeout(timeout);
      clearInterval(interval);
    }
  });

  test("util.format and a Console print the text util.inspect gives", () => {
    let written = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        written += chunk;
        callback();
      },
    });
    const console = new Console({ stdout: stream, stderr: stream, colorMode: false });
    console.log(make.Blob());
    console.log("%o", make.Headers());
    console.error(make.AbortSignal());
    assert.deepStrictEqual(
      [format("%o", make.Blob()), format("%O", make.Headers()), format(make.TextDecoder()), written.split("\n")],
      [
        "Blob { size: 5, type: 'text/csv' }",
        "Headers { 'x-request-id': 'abc123' }",
        "TextDecoder { encoding: 'utf-16le', fatal: true, ignoreBOM: false }",
        [
          "Blob { size: 5, type: 'text/csv' }",
          "Headers { 'x-request-id': 'abc123' }",
          "AbortSignal { aborted: true }",
          "",
        ],
      ],
    );
  });

  test("colors", () => {
    const event = new Event("ping");
    assert.deepStrictEqual(
      [
        inspect(make.Blob(), { colors: true }),
        inspect({ it: make.File() }, { depth: 0, colors: true }),
        inspect(make.Headers(), { colors: true }),
        inspect(event, { colors: true }).split("\n")[1],
        // undici turns colors on when the caller did not say.
        (make.Response() as any)[custom](2, {}).split("\n")[1],
        inspect(make.Response()).split("\n")[1],
        // The methods inside the print have the colors too.
        inspect(make.Request(), { depth: 0, colors: undefined }).split("\n").at(-2),
      ],
      [
        "Blob { size: \x1b[33m5\x1b[39m, type: \x1b[32m'text/csv'\x1b[39m }",
        "{ it: \x1b[36m[File]\x1b[39m }",
        "Headers { \x1b[32m'x-request-id'\x1b[39m: \x1b[32m'abc123'\x1b[39m }",
        "  type: \x1b[32m'ping'\x1b[39m,",
        "  status: \x1b[33m404\x1b[39m,",
        "  status: 404,",
        "  signal: \x1b[36m[AbortSignal]\x1b[39m",
      ],
    );
  });

  test("console.log in a node:worker_threads Worker", async () => {
    const worker = new Worker(
      `console.log(new Blob(["hello"], { type: "text/csv" }));
       console.log(new Headers({ "x-request-id": "abc123" }));`,
      { eval: true, stdout: true },
    );
    let stdout = "";
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", chunk => (stdout += chunk));
    await new Promise((resolve, reject) => {
      worker.on("exit", resolve);
      worker.on("error", reject);
    });
    // The Console of a Worker has colors where the process has them.
    assert.strictEqual(
      stripVTControlCharacters(stdout),
      "Blob { size: 5, type: 'text/csv' }\nHeaders { 'x-request-id': 'abc123' }\n",
    );
  });
});

const flat = (value: unknown) => inspect(value, { breakLength: Infinity });
const past = (value: unknown) => inspect({ it: value }, { depth: 0 });

describe("a subclass", () => {
  class MyBlob extends Blob {}
  class MyFile extends File {}
  class MyEvent extends Event {}
  class MyTextDecoder extends TextDecoder {}
  class MyAbortController extends AbortController {}
  class Derived extends Blob {}
  class Other extends TextDecoder {}

  test("prints the name node prints", () => {
    const event = new MyEvent("ping");
    const customEvent = new CustomEvent("c");
    assert.deepStrictEqual(
      [
        new (class MyHeaders extends Headers {})({ a: "1" }),
        new (class MyResponse extends Response {})(null),
        new MyBlob(["hello"]),
        new MyFile(["hello"], "report.csv", { lastModified: 5 }),
        new (class MyFormData extends FormData {})(),
        event,
        customEvent,
        new MyTextDecoder(),
        new MyAbortController(),
      ].map(flat),
      [
        // undici and node:buffer print the name of the class.
        "Headers { a: '1' }",
        "Response { status: 200, statusText: '', headers: Headers {}, body: null, bodyUsed: false, ok: true, redirected: false, type: 'default', url: '' }",
        "Blob { size: 5, type: '' }",
        "File { size: 5, type: '', name: 'report.csv', lastModified: 5 }",
        "FormData {}",
        // These print the name of the constructor.
        `MyEvent { type: 'ping', defaultPrevented: false, cancelable: false, timeStamp: ${event.timeStamp} }`,
        `CustomEvent { type: 'c', defaultPrevented: false, cancelable: false, timeStamp: ${customEvent.timeStamp} }`,
        "MyTextDecoder { encoding: 'utf-8', fatal: false, ignoreBOM: false }",
        "MyAbortController { signal: AbortSignal { aborted: false } }",
      ],
    );
  });

  test("past the depth limit has the constructor's name and the tag", () => {
    // Node v26.3.0 leaves the tag out when the constructor's name has it in it. v26.9.0 has no such rule (nodejs/node#63257).
    const why = "Bun's util.inspect always adds the tag of a subclass";
    assert.deepStrictEqual(
      [
        past(new MyBlob(["hello"])),
        past(new Derived(["hello"])),
        past(new MyFile(["hello"], "report.csv")),
        past(new MyTextDecoder()),
        past(new Other()),
        past(new MyEvent("ping")),
        past(new MyAbortController()),
      ],
      [
        differs("{ it: [MyBlob] }", "{ it: [MyBlob [Blob]] }", why),
        "{ it: [Derived [Blob]] }",
        differs("{ it: [MyFile] }", "{ it: [MyFile [File]] }", why),
        differs("{ it: [MyTextDecoder] }", "{ it: [MyTextDecoder [TextDecoder]] }", why),
        "{ it: [Other [TextDecoder]] }",
        "{ it: MyEvent }",
        differs("{ it: MyAbortController {} }", "{ it: MyAbortController [AbortController] {} }", why),
      ],
    );
  });

  test("a class with no name prints as node prints it", () => {
    const event = new (class extends Event {})("ping");
    assert.deepStrictEqual(
      [
        flat(new (class extends TextDecoder {})()),
        flat(event),
        flat(new (class extends AbortController {})()),
        past(new (class extends Blob {})([])),
      ],
      [
        "TextDecoder { encoding: 'utf-8', fatal: false, ignoreBOM: false }",
        ` { type: 'ping', defaultPrevented: false, cancelable: false, timeStamp: ${event.timeStamp} }`,
        " { signal: AbortSignal { aborted: false } }",
        "{ it: [Blob] }",
      ],
    );
  });
});

describe("the receiver", () => {
  // Node.js keeps the state of these six in private fields, so its method throws for a receiver that is not the instance.
  const privateField: Record<string, string> = {
    Headers: "#headersList",
    Response: "#state",
    Request: "#state",
    FormData: "#state",
    AbortController: "#signal",
    Event: "#defaultPrevented",
  };
  const notDeclared = (name: string) =>
    `TypeError: Cannot read private member ${privateField[name]} from an object whose class did not declare it`;
  const why = "Node.js reads a private field of the receiver. Bun finds the instance";

  for (const [label, wrap] of [
    ["a Proxy around an instance prints its state", (value: object) => new Proxy(value, {})],
    ["an object that inherits from an instance prints its state", (value: object) => Object.create(value)],
  ] as const) {
    test(label, () => {
      const actual: Record<string, string> = {};
      const expected: Record<string, string> = {};
      for (const [name, create] of Object.entries(make)) {
        const value = create();
        actual[name] = outcome(() => flat(wrap(value)));
        expected[name] = name in privateField ? differs(notDeclared(name), flat(value), why) : flat(value);
      }
      assert.deepStrictEqual(actual, expected);
    });
  }

  test("a Proxy's traps do not run", () => {
    let traps = 0;
    const handler = new Proxy({}, { get: () => (traps++, undefined) });
    const texts = [new Blob(["hello"]), AbortSignal.abort(), new TextDecoder()].map(value =>
      flat(new Proxy(value, handler)),
    );
    assert.deepStrictEqual(texts, [
      "Blob { size: 5, type: '' }",
      "AbortSignal { aborted: true }",
      "TextDecoder { encoding: 'utf-8', fatal: false, ignoreBOM: false }",
    ]);
    assert.strictEqual(
      String(traps > 0),
      differs("true", "false", "Node.js reads each field through the Proxy. Bun reads the instance"),
    );
  });

  test("a receiver that holds no instance", () => {
    const invalidThis = (name: string) => `TypeError [ERR_INVALID_THIS]: Value of "this" must be of type ${name}`;
    const whyPlain = "Bun gives the receiver back, or says that it is not an instance. Node.js reads undefined fields";
    const actual: Record<string, string> = {};
    for (const [name, create] of Object.entries(make)) {
      const method = (Object.getPrototypeOf(create()) as any)[custom];
      actual[name] = outcome(() => method.call({}, 2, {})).split("\n")[0];
    }
    assert.deepStrictEqual(actual, {
      Headers: differs(notDeclared("Headers"), invalidThis("Headers"), whyPlain),
      Response: differs("Response {", "(returns object)", whyPlain),
      Request: differs("Request {", "(returns object)", whyPlain),
      Blob: differs("Blob { size: undefined, type: undefined }", "(returns object)", whyPlain),
      File: differs("TypeError: Cannot read properties of undefined (reading 'name')", "(returns object)", whyPlain),
      FormData: differs(notDeclared("FormData"), invalidThis("FormData"), whyPlain),
      AbortSignal: differs("Object { aborted: undefined }", "(returns object)", whyPlain),
      AbortController: differs("Object { signal: undefined }", "(returns object)", whyPlain),
      Event: invalidThis("Event"),
      TextDecoder: invalidThis("TextDecoder"),
    });
  });

  test("null as the receiver is an error", () => {
    const invalidThis = (name: string) => `TypeError [ERR_INVALID_THIS]: Value of "this" must be of type ${name}`;
    const reading = (name: string) => `TypeError: Cannot read properties of null (reading '${name}')`;
    const whyNull = "Bun's error says which class the receiver must be";
    const actual: Record<string, string> = {};
    for (const [name, create] of Object.entries(make)) {
      const method = (Object.getPrototypeOf(create()) as any)[custom];
      actual[name] = outcome(() => method.call(null, 2, {}));
    }
    assert.deepStrictEqual(actual, {
      Headers: differs(reading("#headersList"), invalidThis("Headers"), whyNull),
      Response: differs(reading("status"), invalidThis("Response"), whyNull),
      Request: differs(reading("method"), invalidThis("Request"), whyNull),
      Blob: differs(reading("size"), invalidThis("Blob"), whyNull),
      File: differs(reading("size"), invalidThis("Blob"), whyNull),
      FormData: differs(reading("#state"), invalidThis("FormData"), whyNull),
      AbortSignal: differs(reading("aborted"), invalidThis("AbortSignal"), whyNull),
      AbortController: differs(reading("signal"), invalidThis("AbortController"), whyNull),
      Event: invalidThis("Event"),
      TextDecoder: invalidThis("TextDecoder"),
    });
  });

  test("the method of one class on an instance of another", () => {
    const blobMethod = (Blob.prototype as any)[custom];
    const eventMethod = (Event.prototype as any)[custom];
    assert.deepStrictEqual(
      [outcome(() => eventMethod.call(new Blob([]), 2, {})), outcome(() => blobMethod.call(new TextDecoder(), 2, {}))],
      [
        'TypeError [ERR_INVALID_THIS]: Value of "this" must be of type Event',
        differs("Blob { size: undefined, type: undefined }", "(returns object)", "Bun gives the receiver back"),
      ],
    );
  });
});

describe("what the class holds in Bun", () => {
  test("Headers: the names are lower-case, in the order that Bun stores them", () => {
    const headers = new Headers([
      ["X-B", "2"],
      ["Accept", "a"],
      ["x-a", "1"],
      ["Content-Type", "text/plain"],
    ]);
    assert.strictEqual(
      flat(headers),
      differs(
        "Headers { 'X-B': '2', Accept: 'a', 'x-a': '1', 'Content-Type': 'text/plain' }",
        "Headers { accept: 'a', 'content-type': 'text/plain', 'x-b': '2', 'x-a': '1' }",
        "undici keeps the case and the order of the names. Bun's header list does not",
      ),
    );
  });

  test("Response: a string body has no stream and no content-type until something asks", () => {
    const tail = "bodyUsed: false, ok: true, redirected: false, type: 'default', url: '' }";
    assert.strictEqual(
      flat(new Response("hello")),
      differs(
        "Response { status: 200, statusText: '', headers: Headers { 'content-type': 'text/plain;charset=UTF-8' }, " +
          `body: ReadableStream { locked: false, state: 'readable', supportsBYOB: true }, ${tail}`,
        `Response { status: 200, statusText: '', headers: Headers {}, ${tail}`,
        "Bun makes the stream at the first read of response.body, and a print makes nothing",
      ),
    );
  });

  test("Timeout: a timer that was cleared keeps its delay and its callback", () => {
    const timeout = setTimeout(onTimeout, 50);
    clearTimeout(timeout);
    const text = inspect(timeout);
    const why = "Node.js sets _idleTimeout to -1 and _onTimeout to null";
    assert.deepStrictEqual(
      [/_idleTimeout: (-?\d+)/.exec(text)?.[1], String(/_onTimeout: null/.test(text)), /_destroyed: true/.test(text)],
      [differs("-1", "50", why), differs("true", "false", why), true],
    );
  });

  test("TextDecoder: showHidden adds nothing", () => {
    assert.strictEqual(
      inspect(new TextDecoder(), { showHidden: true }).replace(/\s+/g, " "),
      differs(
        "TextDecoder { encoding: 'utf-8', fatal: false, ignoreBOM: false, Symbol(flags): 0, Symbol(handle): undefined }",
        "TextDecoder { encoding: 'utf-8', fatal: false, ignoreBOM: false }",
        "Bun's TextDecoder has no flags and no handle",
      ),
    );
  });
});

describe("a property that a program put on the value", () => {
  test("a data property with the name of a field is the field, as in Node.js", () => {
    class StatusField extends Response {
      status = 1;
    }
    const response = new Response(null);
    Object.defineProperty(response, "url", { value: "http://own/" });
    class ProtoData extends Blob {}
    Object.defineProperty(ProtoData.prototype, "type", { value: "proto/type" });
    const signal = AbortSignal.abort();
    Object.defineProperty(signal, "aborted", { value: "yes" });
    const decoder = new TextDecoder();
    Object.defineProperty(decoder, "encoding", { value: "x" });
    const controller = new AbortController();
    Object.defineProperty(controller, "signal", { value: 5 });
    const child = Object.create(new Blob(["abc"]));
    Object.defineProperty(child, "type", { value: "child/type" });
    assert.deepStrictEqual(
      [
        flat(new StatusField(null)).slice(0, 22),
        flat(response).slice(-20),
        flat(new ProtoData(["x"])),
        flat(signal),
        flat(decoder),
        flat(controller),
        flat(child),
      ],
      [
        "Response { status: 1, ",
        "url: 'http://own/' }",
        "Blob { size: 1, type: 'proto/type' }",
        "AbortSignal { aborted: 'yes' }",
        "TextDecoder { encoding: 'x', fatal: false, ignoreBOM: false }",
        "AbortController { signal: 5 }",
        "Blob { size: 3, type: 'child/type' }",
      ],
    );
  });

  test("an accessor with the name of a field is not called", () => {
    let calls = 0;
    class Getter extends Blob {
      get size() {
        calls++;
        return 99;
      }
    }
    const own = new Blob(["x"]);
    Object.defineProperty(own, "size", { get: () => (calls++, 42) });
    const why = "Node.js reads this.size. Bun prints the state of the class and runs no getter";
    assert.deepStrictEqual(
      [flat(new Getter(["x"])), flat(own), String(calls)],
      [
        differs("Blob { size: 99, type: '' }", "Blob { size: 1, type: '' }", why),
        differs("Blob { size: 42, type: '' }", "Blob { size: 1, type: '' }", why),
        differs("2", "0", why),
      ],
    );
  });

  test("a property with another name does not show, and customInspect: false shows it", () => {
    const request = make.Request();
    const pristine = inspect(request);
    (request as any).user = { id: 7 };
    assert.deepStrictEqual(
      [inspect(request), inspect(request, { customInspect: false }).includes("user: { id: 7 }")],
      [pristine, true],
    );
  });

  test("a name that node reads and Bun's Request does not have shows when a program put it there", () => {
    const request = new Request("http://example.com/");
    Object.defineProperty(request, "keepalive", { value: true });
    assert.strictEqual(
      flat(request).slice(flat(request).indexOf("integrity")),
      differs(
        "integrity: '', keepalive: true, isReloadNavigation: false, isHistoryNavigation: false, signal: AbortSignal { aborted: false } }",
        "integrity: '', keepalive: true, signal: AbortSignal { aborted: false } }",
        requestWhy,
      ),
    );
  });

  test("with getters: true, a getter that a program put on a timer runs on the timer", () => {
    const timeout = setTimeout(onTimeout, 50);
    try {
      Object.defineProperty(timeout, "isTheTimer", {
        get() {
          return this === timeout;
        },
        enumerable: true,
      });
      assert.match(inspect(timeout, { getters: true }), /isTheTimer: \[Getter: true\]/);
    } finally {
      clearTimeout(timeout);
    }
  });

  test("a value that holds itself where the depth counts down prints as in Node.js", () => {
    const controller = new AbortController();
    Object.defineProperty(controller, "signal", { value: controller });
    assert.strictEqual(
      inspect(controller),
      "AbortController { signal: AbortController { signal: AbortController {} } }",
    );
  });
});

describe("past the depth limit, a value prints as util.inspect prints any value there", () => {
  test("the constructor is one that the value is an instance of, and an own tag does not show", () => {
    const ownConstructor = new Blob([]);
    Object.defineProperty(ownConstructor, "constructor", { value: function Foo() {} });
    const ownTag = new Blob([]);
    Object.defineProperty(ownTag, Symbol.toStringTag, { value: "Own", enumerable: true });
    const hiddenTag = new Blob([]);
    Object.defineProperty(hiddenTag, Symbol.toStringTag, { value: "Hidden" });
    class SymbolName extends Blob {
      static name: any = Symbol("n");
    }
    const decoder = new TextDecoder();
    Object.defineProperty(decoder, "constructor", { value: class Other {} });
    assert.deepStrictEqual(
      [past(ownConstructor), past(ownTag), past(hiddenTag), past(new SymbolName([])), past(decoder)],
      [
        "{ it: [Blob] }",
        "{ it: [Blob] }",
        "{ it: [Blob [Hidden]] }",
        "{ it: [Symbol(n) [Blob]] }",
        "{ it: [TextDecoder] }",
      ],
    );
  });

  test("a File keeps a name and a tag that a program gave it", () => {
    const NamedBlob = (Base => class Blob extends Base {})(File);
    class Tagged extends File {
      get [Symbol.toStringTag]() {
        return "Blob";
      }
    }
    const ownTag = Object.defineProperty(new File([], "a.txt"), Symbol.toStringTag, { value: "Blob" });
    assert.deepStrictEqual(
      [past(new NamedBlob([], "a.txt")), past(new Tagged([], "a.txt")), past(ownTag)],
      ["{ it: [Blob [File]] }", "{ it: [Tagged [Blob]] }", "{ it: [File [Blob]] }"],
    );
  });

  test("a receiver that inherits from a value has no key of its own", () => {
    assert.deepStrictEqual(
      [past(Object.create(new Blob([]))), past(Object.create(new TextDecoder()))],
      ["{ it: Blob {} }", "{ it: TextDecoder {} }"],
    );
  });

  test("the body of a Response", () => {
    const response = new Response(new ReadableStream());
    const body = (text: string) =>
      text
        .split("\n")
        .find(line => line.includes("body:"))
        ?.trim();
    assert.deepStrictEqual(
      [body(inspect(response)), body(inspect(response, { depth: 0 }))],
      [
        "body: ReadableStream { locked: false, state: 'readable', supportsBYOB: false },",
        differs(
          "body: undefined,",
          "body: ReadableStream {},",
          "Node's method for a stream returns undefined past the depth limit. Bun's returns the stream",
        ),
      ],
    );
  });

  test("a direct call with a depth below zero", () => {
    const why = "Node.js returns the value, and its util.inspect prints [Blob] for it. Bun returns that text";
    assert.deepStrictEqual(
      ["Blob", "File", "AbortSignal", "TextDecoder", "AbortController", "Event"].map(name => {
        const value = (make as any)[name]();
        return outcome(() => value[custom](-1, {}));
      }),
      [
        differs("(returns object)", "[Blob]", why),
        differs("(returns object)", "[File]", why),
        differs("(returns object)", "[AbortSignal]", why),
        differs("(returns object)", "[TextDecoder]", why),
        "(returns object)",
        "Event",
      ],
    );
  });
});

describe("options and errors", () => {
  test("a function as the options of a fetch class is an error, as in undici", () => {
    const form = new FormData();
    form.append("a", "1");
    const invalid =
      'TypeError [ERR_INVALID_ARG_TYPE]: The "inspectOptions" argument must be of type object. Received function ';
    assert.deepStrictEqual(
      [form, new Response(null), new Headers()].map(value => outcome(() => (value as any)[custom](2, function () {}))),
      [invalid, invalid, invalid],
    );
  });

  test("a second call with the same options object prints the same text", () => {
    const response = new Response(null);
    const request = new Request("http://127.0.0.1:1/");
    const options: Record<string, unknown> = { depth: 2 };
    const first = [(response as any)[custom](2, options), (request as any)[custom](2, options)];
    assert.deepStrictEqual(
      [[(response as any)[custom](2, options), (request as any)[custom](2, options)], Object.keys(options)],
      // undici sets `colors` in the options that it got.
      [first, ["depth", "colors"]],
    );
    assert.match(first[0], /^Response \{/);
  });

  test("an error that a nested method throws is the error that util.inspect throws", () => {
    const error = new RangeError("boom");
    let caught: unknown;
    try {
      inspect({
        a: {
          [custom]() {
            throw error;
          },
        },
      });
    } catch (thrown) {
      caught = thrown;
    }
    assert.strictEqual(caught, error);
    // The same for the error of one of the methods.
    const method = (Event.prototype as any)[custom];
    assert.throws(() => inspect({ a: { b: { [custom]: () => method.call({}, 2, {}) } } }), {
      code: "ERR_INVALID_THIS",
    });
  });

  test("with getters: true, a method that throws null inside a getter's value prints as the getter's error", () => {
    const thrower = (value: null | undefined) => ({
      get config() {
        return {
          [custom]() {
            throw value;
          },
        };
      },
      after: 1,
    });
    assert.deepStrictEqual(
      [inspect(thrower(null), { getters: true }), inspect(thrower(undefined), { getters: true })],
      [
        "{ config: [Getter: <Inspection threw (null)>], after: 1 }",
        "{ config: [Getter: <Inspection threw (undefined)>], after: 1 }",
      ],
    );
  });
});

// The prototypes that own the method in Node.js v26.3.0 and that a global or a module export gives, and Timeout.
describe("the prototypes that own the method in Node.js", () => {
  const globals = [
    "AbortController",
    "AbortSignal",
    "Blob",
    "BroadcastChannel",
    "Buffer",
    "ByteLengthQueuingStrategy",
    "CompressionStream",
    "CountQueuingStrategy",
    "CryptoKey",
    "DecompressionStream",
    "Event",
    "EventTarget",
    "FormData",
    "Headers",
    "MessagePort",
    "Performance",
    "PerformanceEntry",
    "PerformanceObserver",
    "PerformanceObserverEntryList",
    "ReadableByteStreamController",
    "ReadableStream",
    "ReadableStreamBYOBReader",
    "ReadableStreamBYOBRequest",
    "ReadableStreamDefaultController",
    "ReadableStreamDefaultReader",
    "Request",
    "Response",
    "TextDecoder",
    "TextDecoderStream",
    "TextEncoder",
    "TextEncoderStream",
    "TransformStream",
    "TransformStreamDefaultController",
    "URL",
    "URLSearchParams",
    "WritableStream",
    "WritableStreamDefaultController",
    "WritableStreamDefaultWriter",
  ];
  const prototypes: [string, () => object][] = [
    ...globals.map((name): [string, () => object] => [name, () => (globalThis as any)[name].prototype]),
    // In Node.js, File.prototype has a method of its own. In Bun, a File has Blob.prototype.
    ["File", () => Object.getPrototypeOf(new File([], "a"))],
    ["AssertionError", () => assert.AssertionError.prototype],
    ["X509Certificate", () => X509Certificate.prototype],
    ["BlockList", () => BlockList.prototype],
    ["SocketAddress", () => SocketAddress.prototype],
    [
      "Timeout",
      () => {
        const timeout = setTimeout(onTimeout, 50);
        clearTimeout(timeout);
        return Object.getPrototypeOf(timeout);
      },
    ],
  ];
  const todoInBun = new Set([
    "BlockList",
    "EventTarget",
    "Performance",
    "PerformanceObserver",
    "PerformanceObserverEntryList",
    "SocketAddress",
    "TextEncoder",
    "X509Certificate",
  ]);

  for (const [name, prototype] of prototypes) {
    test(name, { todo: isBun && todoInBun.has(name) }, () => {
      assert.strictEqual(typeof Object.getOwnPropertyDescriptor(prototype(), custom)?.value, "function");
    });
  }

  test("the method of the eleven classes has node's name, length and attributes", () => {
    const timeout = setTimeout(onTimeout, 50);
    clearTimeout(timeout);
    assert.deepStrictEqual(
      [Response, Request, Headers, FormData, Blob, AbortSignal, AbortController, Event, TextDecoder]
        .map(constructor => constructor.prototype as object)
        .concat(Object.getPrototypeOf(timeout))
        .map(prototype => {
          const { value, ...attributes } = Object.getOwnPropertyDescriptor(prototype, custom)!;
          return [value.name, value.length, attributes];
        }),
      Array.from({ length: 10 }, () => [
        "[nodejs.util.inspect.custom]",
        2,
        { writable: true, enumerable: false, configurable: true },
      ]),
    );
  });
});

// The assertions about these methods in the tests of Node.js v26.3.0. Event has its own in test/js/node/test/parallel.
describe("upstream", () => {
  test("node: test-blob.js", () => {
    const b = new Blob();
    assert.strictEqual(inspect(b, { depth: null }), "Blob { size: 0, type: '' }");
    assert.strictEqual(inspect(b, { depth: 1 }), "Blob { size: 0, type: '' }");
    assert.strictEqual(inspect(b, { depth: -1 }), "[Blob]");
  });

  test("node: test-file.js", () => {
    const file = new File([], "");
    assert(inspect(file).startsWith("File { size: 0, type: '', name: '', lastModified:"));
  });

  test("node: test-abortcontroller.js, AbortController inspection depth 1 or null works", () => {
    const ac = new AbortController();
    assert.strictEqual(inspect(ac, { depth: 1 }), "AbortController { signal: [AbortSignal] }");
    assert.strictEqual(inspect(ac, { depth: null }), "AbortController { signal: AbortSignal { aborted: false } }");
  });

  test("node: test-whatwg-encoding-custom-textdecoder.js", () => {
    // Test TextDecoder inspect with hidden fields
    {
      const dec = new TextDecoder("utf-8", { ignoreBOM: true });
      assert.strictEqual(
        inspect(dec, { showHidden: true }),
        differs(
          "TextDecoder {\n" +
            "  encoding: 'utf-8',\n" +
            "  fatal: false,\n" +
            "  ignoreBOM: true,\n" +
            "  Symbol(flags): 4,\n" +
            "  Symbol(handle): undefined\n" +
            "}",
          "TextDecoder { encoding: 'utf-8', fatal: false, ignoreBOM: true }",
          "Bun's TextDecoder has no flags and no handle",
        ),
      );
    }

    // Test TextDecoder inspect without hidden fields
    {
      const dec = new TextDecoder("utf-8", { ignoreBOM: true });
      assert.strictEqual(
        inspect(dec, { showHidden: false }),
        "TextDecoder { encoding: 'utf-8', fatal: false, ignoreBOM: true }",
      );
    }

    // Test TextDecoder inspect with negative depth
    {
      const dec = new TextDecoder();
      assert.strictEqual(inspect(dec, { depth: -1 }), "[TextDecoder]");
    }

    {
      const inspectFn = (TextDecoder.prototype as any)[custom];
      const instance = new TextDecoder();
      const expectedError = {
        code: "ERR_INVALID_THIS",
        name: "TypeError",
        message: 'Value of "this" must be of type TextDecoder',
      };

      inspectFn.call(instance, Infinity, {});

      const invalidThisArgs = [{}, [], true, 1, "", new TextEncoder()];
      invalidThisArgs.forEach(i => {
        assert.throws(() => inspectFn.call(i, Infinity, {}), expectedError);
      });
    }
  });
});

// The text in this file is the text of one version of Node.js.
test("Node.js passes this file", { skip: !isBun }, () => {
  const version = spawnSync("node", ["-p", "process.versions.node"], { encoding: "utf8" });
  if (version.status !== 0 || version.stdout.trim() !== process.versions.node) {
    // No `node` on the path, or another version: its text for some rows is not this text.
    return;
  }
  const run = spawnSync("node", ["--test", import.meta.filename], {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NODE_NO_WARNINGS: "1" },
  });
  assert.strictEqual(run.status, 0, run.stdout.slice(-4000));
});
