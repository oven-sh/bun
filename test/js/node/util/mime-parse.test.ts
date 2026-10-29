/**
 * util.MIMEType.parse(), which Node.js has since v26.8.0 (https://github.com/nodejs/node/pull/64965), and what
 * `new MIMEType` must keep now that it shares its parser with that method.
 *
 * All tests in this file run in both Bun and Node.js: `bun test` runs them here, and the last test runs this same
 * file under Node.js when the machine has v26.8.0 or later. The expected values are the output of Node.js v26.12.1.
 * The file cannot import from "harness" at the top for that reason.
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MIMEParams, MIMEType } from "node:util";
import wptMimeTypesGenerated from "../test/fixtures/mime-whatwg-generated.js";
import wptMimeTypes from "../test/fixtures/mime-whatwg.js";

// Not yet in @types/node 26.
const MIMETypeWithParse = MIMEType as typeof MIMEType & { parse(input?: unknown): MIMEType | null };

type Described = { type: string; subtype: string; essence: string; params: [string, string][]; string: string };
const describeMime = (mime: MIMEType | null): Described | null =>
  mime && {
    type: mime.type,
    subtype: mime.subtype,
    essence: mime.essence,
    params: [...mime.params],
    string: `${mime}`,
  };

describe("new MIMEType", () => {
  test("ERR_INVALID_MIME_SYNTAX names the first production that fails, and where it fails", () => {
    const failure = (input: string) => {
      try {
        new MIMEType(input);
      } catch (e) {
        return `${(e as Error).name} ${(e as { code?: string }).code}: ${(e as Error).message}`;
      }
      return "no error";
    };

    assert.deepStrictEqual(
      {
        "text plain": failure("text plain"),
        " text plain": failure(" text plain"),
        "a b/c d": failure("a b/c d"),
        "a/b c;x=1": failure("a/b c;x=1"),
        "\ta/ b": failure("\ta/ b"),
        "a/b\u0100 ;q": failure("a/b\u0100 ;q"),
      },
      {
        "text plain": 'TypeError ERR_INVALID_MIME_SYNTAX: The MIME syntax for a type in "text plain" is invalid at 4',
        " text plain": 'TypeError ERR_INVALID_MIME_SYNTAX: The MIME syntax for a type in " text plain" is invalid at 4',
        "a b/c d": 'TypeError ERR_INVALID_MIME_SYNTAX: The MIME syntax for a type in "a b/c d" is invalid at 1',
        "a/b c;x=1": 'TypeError ERR_INVALID_MIME_SYNTAX: The MIME syntax for a subtype in "a/b c;x=1" is invalid at 1',
        "\ta/ b": 'TypeError ERR_INVALID_MIME_SYNTAX: The MIME syntax for a subtype in "\ta/ b" is invalid at 0',
        "a/b\u0100 ;q":
          'TypeError ERR_INVALID_MIME_SYNTAX: The MIME syntax for a subtype in "a/b\u0100 ;q" is invalid at 1',
      },
    );
  });

  test("reads the prototype of newTarget before it converts its argument", () => {
    const construct = (input: string) => {
      const log: string[] = [];
      const target = function () {};
      const prototype = target.prototype;
      const newTarget = new Proxy(target, {
        get(object, key, receiver) {
          if (key === "prototype") log.push("prototype");
          return Reflect.get(object, key, receiver);
        },
      });
      const argument = {
        toString() {
          log.push("toString");
          return input;
        },
      };
      try {
        const mime = Reflect.construct(MIMEType, [argument], newTarget);
        log.push(`made ${MIMEType.prototype.toString.call(mime)}`);
        log.push(Object.getPrototypeOf(mime) === prototype ? "with that prototype" : "with another prototype");
      } catch (e) {
        log.push((e as { code: string }).code);
      }
      return log;
    };

    assert.deepStrictEqual(construct("a/b"), ["prototype", "toString", "made a/b", "with that prototype"]);
    assert.deepStrictEqual(construct("a b"), ["prototype", "toString", "ERR_INVALID_MIME_SYNTAX"]);
  });
});

describe("MIMEType.parse", () => {
  test("is an own method of the constructor with the attributes that Node.js gives it", () => {
    const { parse } = MIMETypeWithParse;
    assert.deepStrictEqual(Reflect.ownKeys(MIMEType), ["length", "name", "prototype", "parse"]);
    const descriptor = Object.getOwnPropertyDescriptor(MIMEType, "parse");
    assert.deepStrictEqual(
      { ...descriptor, value: typeof descriptor?.value },
      { value: "function", writable: true, enumerable: false, configurable: true },
    );
    assert.deepStrictEqual(
      { name: parse.name, length: parse.length, ownKeys: Reflect.ownKeys(parse) },
      { name: "parse", length: 1, ownKeys: ["length", "name"] },
    );
    // @ts-expect-error a method is not declared as a constructor
    assert.throws(() => new parse("text/plain"), TypeError);
  });

  const valid: [input: string, expected: Described][] = [
    ["text/plain", { type: "text", subtype: "plain", essence: "text/plain", params: [], string: "text/plain" }],
    [
      "text/plain;Charset=value",
      {
        type: "text",
        subtype: "plain",
        essence: "text/plain",
        params: [["charset", "value"]],
        string: "text/plain;charset=value",
      },
    ],
    [
      '  TEXT/Html ; Charset=UTF-8;foo="b ar"  ',
      {
        type: "text",
        subtype: "html",
        essence: "text/html",
        params: [
          ["charset", "UTF-8"],
          ["foo", "b ar"],
        ],
        string: 'text/html;charset=UTF-8;foo="b ar"',
      },
    ],
    [
      "\t\n\r text/html \t\n\r;charset=x\t\n\r ",
      {
        type: "text",
        subtype: "html",
        essence: "text/html",
        params: [["charset", "x"]],
        string: "text/html;charset=x",
      },
    ],
    ["a/b;x=1;x=2", { type: "a", subtype: "b", essence: "a/b", params: [["x", "1"]], string: "a/b;x=1" }],
    [
      "text/plain;a=\u00e9;b=\u0100;c=ok",
      {
        type: "text",
        subtype: "plain",
        essence: "text/plain",
        params: [
          ["a", "\u00e9"],
          ["c", "ok"],
        ],
        string: 'text/plain;a="\u00e9";c=ok',
      },
    ],
    [
      "X-Token!#$%&'*+-.^_`|~09/Az",
      {
        type: "x-token!#$%&'*+-.^_`|~09",
        subtype: "az",
        essence: "x-token!#$%&'*+-.^_`|~09/az",
        params: [],
        string: "x-token!#$%&'*+-.^_`|~09/az",
      },
    ],
  ];
  for (const [input, expected] of valid) {
    test(`returns for ${JSON.stringify(input)} what the constructor makes`, () => {
      const parsed = MIMETypeWithParse.parse(input);
      assert.deepStrictEqual(describeMime(parsed), expected);
      assert.deepStrictEqual(describeMime(new MIMEType(input)), expected);
      assert.strictEqual(Object.getPrototypeOf(parsed), MIMEType.prototype);
      assert.ok(parsed!.params instanceof MIMEParams);
    });
  }

  // No value is pinned here: Bun and Node.js v26.12.1 do not read these two parameter lists alike.
  test("returns the parameters that the constructor makes when a quoted value is malformed", () => {
    for (const input of ['text/html;x="y"charset=evil;charset=utf-8', 'a/b;a="b\n']) {
      assert.deepStrictEqual(describeMime(MIMETypeWithParse.parse(input)), describeMime(new MIMEType(input)));
    }
  });

  test("returns null where the constructor throws ERR_INVALID_MIME_SYNTAX", () => {
    const inputs = [
      "text plain",
      " text plain",
      "",
      " \t\r\n",
      "/",
      "text/",
      "/plain",
      "text/ html",
      "text/pl ain;a=b",
      "a b/c d",
      "te\u0100xt/plain",
      "text/pl\u00e9in",
      "text/\ud800",
      undefined,
      null,
      123,
      true,
      1n,
      {},
      [],
    ];
    for (const input of inputs) {
      assert.strictEqual(MIMETypeWithParse.parse(input), null);
      // @ts-expect-error the constructor is declared to take a string
      assert.throws(() => new MIMEType(input), { name: "TypeError", code: "ERR_INVALID_MIME_SYNTAX" });
    }
    assert.strictEqual(MIMETypeWithParse.parse(), null);
  });

  test("gives the expected result for every input of the WPT corpus", () => {
    const differences: unknown[] = [];
    const counts = { valid: 0, invalid: 0 };
    for (const entry of [...wptMimeTypes, ...wptMimeTypesGenerated]) {
      if (typeof entry === "string") continue;
      const parsed = MIMETypeWithParse.parse(entry.input);
      const output = parsed === null ? null : `${parsed}`;
      if (output !== entry.output) differences.push({ input: entry.input, expected: entry.output, received: output });
      counts[entry.output === null ? "invalid" : "valid"]++;
    }
    assert.deepStrictEqual(differences, []);
    assert.ok(counts.valid > 0);
    assert.ok(counts.invalid > 0);
  });

  test("converts its argument to a string once, and lets an error of the conversion through", () => {
    let conversions = 0;
    const counted = (text: string) => ({
      toString() {
        conversions++;
        return text;
      },
    });
    assert.strictEqual(`${MIMETypeWithParse.parse(counted("a/b;c=d"))}`, "a/b;c=d");
    assert.strictEqual(conversions, 1);
    assert.strictEqual(MIMETypeWithParse.parse(counted("a b")), null);
    assert.strictEqual(conversions, 2);

    assert.throws(() => MIMETypeWithParse.parse(Symbol("a/b")), TypeError);

    // Only a syntax failure of the parser gives null. An error with the same code from user code is not one.
    const error = Object.assign(new RangeError("from toString"), { code: "ERR_INVALID_MIME_SYNTAX" });
    let thrown: unknown;
    try {
      MIMETypeWithParse.parse({
        toString() {
          throw error;
        },
      });
    } catch (e) {
      thrown = e;
    }
    assert.strictEqual(thrown, error);
  });

  test("does not read its receiver, and does not run the constructor of a subclass", () => {
    const { parse } = MIMETypeWithParse;
    assert.strictEqual(`${parse("a/b")}`, "a/b");
    assert.strictEqual(`${parse.call(undefined, "a/b")}`, "a/b");
    assert.strictEqual(parse.call(null, "a b"), null);
    assert.strictEqual(Object.getPrototypeOf(Reflect.apply(parse, Map, ["a/b"])), MIMEType.prototype);

    let constructed = 0;
    class Sub extends MIMEType {
      constructor(input: string) {
        super(input);
        constructed++;
      }
    }
    const SubWithParse = Sub as typeof Sub & typeof MIMETypeWithParse;
    const fromSub = SubWithParse.parse("a/b");
    assert.deepStrictEqual(
      {
        own: Object.hasOwn(Sub, "parse"),
        inherited: SubWithParse.parse === parse,
        prototype: Object.getPrototypeOf(fromSub) === MIMEType.prototype,
        constructed,
      },
      { own: false, inherited: true, prototype: true, constructed: 0 },
    );
  });

  test("returns a new object each time", () => {
    const first = MIMETypeWithParse.parse("a/b;c=d")!;
    const second = MIMETypeWithParse.parse("a/b;c=d")!;
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.params, second.params);
    first.type = "x";
    first.subtype = "y";
    first.params.set("k", "v");
    assert.deepStrictEqual([`${first}`, `${second}`], ["x/y;c=d;k=v", "a/b;c=d"]);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Node.js has MIMEType.parse since v26.8.0.
  const node = nodeExeAtLeast("26.8.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node process per file. node:test still exits
      // non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
