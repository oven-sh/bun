import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const NUMBERS = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
];

describe("jest-each", () => {
  it("check types", () => {
    expect(it.each).toBeTypeOf("function");
    expect(it.each([])).toBeTypeOf("function");
  });
  it.each(NUMBERS)("%i + %i = %i", (a, b, e) => {
    expect(a + b).toBe(e);
  });
  it.each(NUMBERS)("with callback: %f + %d = %f", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    // We cast here because we cannot type done when typing args as ...T
    (done as unknown as (err?: unknown) => void)();
  });
  it.each([
    ["a", "b", "ab"],
    ["c", "d", "cd"],
    ["e", "f", "ef"],
  ])("%s + %s = %s", (a, b, res) => {
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(typeof res).toBe("string");
    expect(a.concat(b)).toBe(res);
  });
  it.each([
    { a: 1, b: 1, e: 2 },
    { a: 1, b: 2, e: 3 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 123, e: 125 },
    { a: 15, b: 13, e: 28 },
  ])("add two numbers with object: %o", ({ a, b, e }, cb) => {
    expect(a + b).toBe(e);
    cb();
  });

  it.each([undefined, null, NaN, Infinity])("stringify %#: %j", (arg, cb) => {
    cb();
  });
});

describe.each(["some", "cool", "strings"])("works with describe: %s", s => {
  it(`has access to params : ${s}`, done => {
    expect(s).toBeTypeOf("string");
    done();
  });
});

describe("does not return zero", () => {
  expect(it.each([1, 2])("wat", () => {})).toBeUndefined();
});

describe("tagged template table", () => {
  it.each`
    a      | b      | expected
    ${1}   | ${2}   | ${3}
    ${"x"} | ${"y"} | ${"xy"}
  `("$a + $b = $expected", function (row) {
    expect(arguments.length).toBe(1);
    expect(Reflect.ownKeys(row)).toEqual(["a", "b", "expected"]);
    expect(row.a + row.b).toBe(row.expected);
  });

  it.each`
    a    | b    | expected
    ${1} | ${2} | ${3}
  `("passes done after the row", (row, done) => {
    expect(row).toStrictEqual({ a: 1, b: 2, expected: 3 });
    expect(done).toBeTypeOf("function");
    done();
  });

  const object = { id: 1 };
  it.each`
    object    | nothing | missing      | zero | no       | empty
    ${object} | ${null} | ${undefined} | ${0} | ${false} | ${""}
  `("passes each value through untouched", row => {
    expect(Reflect.ownKeys(row)).toEqual(["object", "nothing", "missing", "zero", "no", "empty"]);
    expect(row.object).toBe(object);
    expect(row).toStrictEqual({ object, nothing: null, missing: undefined, zero: 0, no: false, empty: "" });
  });

  it.each`
    café     | 名前       | 😀
    ${"one"} | ${"Alice"} | ${42}
  `("keeps headings that are not ASCII", row => {
    expect(Reflect.ownKeys(row)).toEqual(["café", "名前", "😀"]);
    expect(row).toStrictEqual({ café: "one", 名前: "Alice", "😀": 42 });
  });

  it.each`
    0         | __proto__  | b        | b
    ${"zero"} | ${"proto"} | ${"old"} | ${"new"}
  `("makes an own data property for an index, __proto__ and a repeated heading", row => {
    const property = (value: string) => ({ value, writable: true, enumerable: true, configurable: true });
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.entries(Object.getOwnPropertyDescriptors(row))).toEqual([
      ["0", property("zero")],
      ["__proto__", property("proto")],
      ["b", property("new")],
    ]);
  });

  describe.each`
    n    | square
    ${2} | ${4}
    ${3} | ${9}
  `("describe.each: $n", function (row) {
    const argumentCount = arguments.length;
    it(`squares to ${row.square}`, () => {
      expect(argumentCount).toBe(1);
      expect(row.n * row.n).toBe(row.square);
    });
  });

  it.if(true).each`
    a
    ${1}
  `("a modifier before .each", row => {
    expect(row).toStrictEqual({ a: 1 });
  });

  it.each`
    a
    ${1}
  `.skipIf(false)("a modifier after .each", row => {
    expect(row).toStrictEqual({ a: 1 });
  });

  it.skip.each`
    a
    ${1}
  `("skip before .each", () => {
    throw new Error("a skipped row ran");
  });

  // Prettier aligns a table that has `it.each` as its tag. This tag keeps the table as written.
  const eachOf = (strings: TemplateStringsArray, first: unknown, ...rest: unknown[]) =>
    it.each(strings, first, ...rest);
  eachOf`

    a|b

    ${1} ${2}
    ${3}
    ${4}
  `("reads the headings from their line and takes the values in order", row => {
    expect(Reflect.ownKeys(row)).toEqual(["a", "b"]);
    expect(row.b - row.a).toBe(1);
  });

  eachOf`
      a    | b
    | ${1} | ${2} |
    | ${3} | ${4} |
  `("takes value rows that start with |", row => {
    expect(Reflect.ownKeys(row)).toEqual(["a", "b"]);
    expect(row.b - row.a).toBe(1);
  });

  // @ts-expect-error an array table takes one argument
  it.each([[1, 2]], "ignored")("an array with more arguments after it is an array table: %d %d", (a, b) => {
    expect([a, b]).toEqual([1, 2]);
  });

  // A tag gets (strings, ...values), and `strings` has an own `raw`.
  const strings = (...cooked: string[]) =>
    Object.assign(cooked, { raw: [...cooked] }) as unknown as TemplateStringsArray;

  it.each(
    strings("\n a|\ud83d\n", "", ""),
    1,
    2,
  )("keeps a heading that is half of a surrogate pair", row => {
    expect(Object.entries(row)).toEqual([
      ["a", 1],
      ["\ud83d", 2],
    ]);
  });

  describe("malformed", () => {
    // `.each` keeps the error of a malformed table. The call with the title throws it.
    const titleCallError = (each: (title: string, fn: () => void) => unknown) => {
      try {
        each("title", () => {});
      } catch (error) {
        return (error as Error).message;
      }
    };
    const noValues =
      "`.each` called with a Tagged Template Literal with no data, remember to interpolate with ${expression} syntax.";
    const noText = "`.each` called with an empty Tagged Template Literal of table data.";
    const badHeadings = (received: string) =>
      `Table headings do not conform to expected format:\n\nheading1 | headingN\n\nReceived:\n\n${received}`;

    it("headings and no values", () => {
      // @ts-expect-error a table needs a value
      const each = it.each`
        a | b
      `;
      expect(titleCallError(each)).toBe(noValues);
      // @ts-expect-error
      const invalidEscape = describe.each`
        \unicode
      `;
      expect(titleCallError(invalidEscape)).toBe(noValues);
    });

    it("no text", () => {
      // @ts-expect-error
      const empty = it.each``;
      expect(titleCallError(empty)).toBe(noText);
      expect(titleCallError((it.each as any)(strings(" \n\t\u00a0\u2028\ufeff")))).toBe(noText);
    });

    it("values that do not fill the last row", () => {
      const each = it.each`
        a    | b
        ${1} | ${2}
        ${3}
      `;
      const message =
        "Not enough arguments supplied for given headings:\na | b\n\nReceived:\n[ 1, 2, 3 ]\n\nMissing 1 argument";
      expect(titleCallError(each)).toBe(message);
      expect(titleCallError(each.skip)).toBe(message);
      expect(titleCallError(each.skipIf(false))).toBe(message);
      expect(
        titleCallError(describe.each`
          café   | b | c
          ${"x"}
        `),
      ).toBe(
        'Not enough arguments supplied for given headings:\ncafé | b | c\n\nReceived:\n[ "x" ]\n\nMissing 2 arguments',
      );
    });

    it("headings that are not a line of their own", () => {
      expect(titleCallError(it.each(strings("a | b\n", ""), 1))).toBe(badHeadings('"a | b\\n"'));
      expect(titleCallError(it.each(strings("\n a | b", ""), 1))).toBe(badHeadings('"\\n a | b"'));
      expect(
        titleCallError(
          it.each`
            \unicode
            ${1}
          `,
        ),
      ).toBe(badHeadings("undefined"));
    });

    it("a heading that is empty or has a space in it", () => {
      for (const header of ["\n a b | c\n", "\n | a\n", "\n a |\n", "\n a||b\n", "\n \n"]) {
        expect(titleCallError(it.each(strings(header, ""), 1))).toBe(badHeadings(JSON.stringify(header)));
      }
    });

    it("a heading row on two lines", () => {
      for (const header of ["\n a |\n b\n", "\n a\n | b\n", "\n a\n |b"]) {
        expect(titleCallError(it.each(strings(header, ""), 1))).toBe(badHeadings(JSON.stringify(header)));
      }
    });
  });

  describe("heading row", () => {
    // The grammar of jest-each, from its src/validation.ts and src/bind.ts.
    const HEADINGS = /^\n\s*[^\s]+\s*(\|\s*[^\s]+\s*)*\n/;
    // bun reads the headings that jest-each reads. Three shapes that jest-each takes are malformed here.
    const expectedHeadings = (header: string) => {
      const match = header.match(HEADINGS)?.[0];
      if (match === undefined) return undefined;
      const names = match.replace(/\s/g, "").split("|");
      const emptyName = names.includes("");
      const rowGoesOnAfterNewline = /\S\s*\n\s*\S/.test(match);
      const pipeAndNameStartNextText = /^\s*\|\s*\S/.test(header.slice(match.length));
      return emptyName || rowGoesOnAfterNewline || pipeAndNameStartNextText ? undefined : names;
    };

    const headers = new Set<string>();
    const add = (prefix: string, depth: number) => {
      headers.add("\n" + prefix);
      if (depth < 4) for (const next of ["\n", " ", "a", "|"]) add(prefix + next, depth + 1);
    };
    add("", 0);
    for (const header of [
      "",
      " a\n",
      "a\n",
      "\n  first | second | third\n  ",
      "\n\n\ta|b \n c\n",
      "\n\ta\t|\tb\t\n",
      "\n a | b\r\n",
      "\n a\u00a0|\u3000b \n",
      "\n a\u2028| b\n",
      "\n\ufeffa | b\n",
      "\n a\u200b | b\n",
      "\n a\rb\n",
      "\n a\u2028b | c\n",
      "\n a |b| c\n d | e\n",
      "\n a | b\n  | c\n",
      "\n a | b\n  | ",
      "\n a | b\n  |c",
      "\n a |\n b\n",
      "\n a||b\n",
      "\n 😀 | é\n",
      "\n \ud83d \n",
    ]) {
      headers.add(header);
    }

    const mismatches: unknown[] = [];
    let accepted = 0;
    for (const header of headers) {
      const expected = expectedHeadings(header);
      if (expected) accepted++;
      // A table of one column takes the one value. With more columns, the error lists the headings.
      const each = (describe.each as any)(strings(header, ""), 0);
      let got: unknown;
      try {
        each("one heading", (row: object) => {
          if (Reflect.ownKeys(row).join("|") !== expected?.join("|")) mismatches.push([header, Reflect.ownKeys(row)]);
        });
        got = 1;
      } catch (error) {
        got = (error as Error).message.split("\n\nReceived:")[0];
      }
      let want: unknown = "Table headings do not conform to expected format:\n\nheading1 | headingN";
      if (expected) {
        want = expected.length > 1 ? "Not enough arguments supplied for given headings:\n" + expected.join(" | ") : 1;
      }
      if (got !== want) mismatches.push([header, got, want]);
    }

    it("has the headings that jest-each reads, or is malformed", () => {
      expect(mismatches).toEqual([]);
      expect({ headers: headers.size, accepted }).toEqual({ headers: 362, accepted: 63 });
    });
  });

  describe.concurrent("in a test run", () => {
    // Runs one test file. `results` has the line of each test, without the duration.
    async function run(contents: string, ...args: string[]) {
      using dir = tempDir("jest-each-template", { "table.test.ts": contents });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./table.test.ts", ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const results = stderr
        .split(/\r?\n/)
        .filter(line => /^\((pass|fail|skip|todo)\) /.test(line))
        .map(line => line.replace(/ \[[\d.]+m?s\]$/, ""));
      return { results, stderr: stderr.replaceAll("\r\n", "\n"), exitCode };
    }

    // The first table is from https://github.com/oven-sh/bun/issues/6364. The rows of the second one have to fail.
    const tables = `
      import { test, expect } from "bun:test";
      test.each\`
        a    | b    | expected
        \${1} | \${2} | \${3}
        \${2} | \${2} | \${4}
      \`("$a and $b add up to $expected", ({ a, b, expected }) => {
        expect(a + b).toBe(expected);
      });
      const price = { apple: 3, pear: 4 };
      test.each\`
        fruit      | expected
        \${"apple"} | \${999}
        \${"pear"}  | \${999}
      \`("price of $fruit is $expected", ({ fruit, expected }) => {
        expect(price[fruit]).toBe(expected);
      });
    `;

    test("runs one test for each row, with the values of the row in the title", async () => {
      const { results, exitCode } = await run(tables);
      expect({ results, exitCode }).toEqual({
        results: [
          "(pass) 1 and 2 add up to 3",
          "(pass) 2 and 2 add up to 4",
          "(fail) price of apple is 999",
          "(fail) price of pear is 999",
        ],
        exitCode: 1,
      });
    });

    test("matches -t against the title of each row", async () => {
      const { results, exitCode } = await run(tables, "-t", "2 and 2|of pear");
      expect({ results, exitCode }).toEqual({
        results: ["(pass) 2 and 2 add up to 4", "(fail) price of pear is 999"],
        exitCode: 1,
      });
    });

    const noValues =
      "`.each` called with a Tagged Template Literal with no data, remember to interpolate with ${expression} syntax.";
    test.each([
      ["headings and no values", "test.each`\n a | b\n`", [], noValues],
      ["no text", "test.each``", [], "`.each` called with an empty Tagged Template Literal of table data."],
      ["an invalid escape and no values", "test.each`\\unicode`", [], noValues],
      [
        "values that do not fill the last row",
        "test.each`\n a | b\n ${1} | ${2}\n ${3}\n`",
        [],
        "Not enough arguments supplied for given headings:\na | b\n\nReceived:\n[ 1, 2, 3 ]\n\nMissing 1 argument",
      ],
      [
        "headings on the line of the backtick",
        "test.each`a | b\n ${1} | ${2}\n`",
        [],
        'Table headings do not conform to expected format:\n\nheading1 | headingN\n\nReceived:\n\n"a | b\\n "',
      ],
      ["test.skip.each", "test.skip.each`\n a | b\n`", [], noValues],
      ["test.todo.each", "test.todo.each`\n a | b\n`", [], noValues],
      ["test.failing.each", "test.failing.each`\n a | b\n`", [], noValues],
      ["describe.each", "describe.each`\n a | b\n`", [], noValues],
      ["a modifier after .each", "test.each`\n a | b\n`.skip", [], noValues],
      ["a title that -t filters out", "test.each`\n a | b\n`", ["-t", "sentinel"], noValues],
    ])("fails the file for a malformed table: %s", async (_, each, args, message) => {
      const { results, stderr, exitCode } = await run(
        `
          import { test, describe } from "bun:test";
          ${each}("row $a", () => {});
          test("sentinel", () => {});
        `,
        ...args,
      );
      expect(stderr).toContain(`error: ${message}\n`);
      expect({ rows: results.filter(line => line.includes("row")), exitCode }).toEqual({ rows: [], exitCode: 1 });
    });

    test("a malformed table that gets no title does not fail the file", async () => {
      const { results, exitCode } = await run(`
        import { test } from "bun:test";
        test.each\`
          a | b
        \`;
        test.each\`
          a | b
          \${1}
        \`;
        test("sentinel", () => {});
      `);
      expect({ results, exitCode }).toEqual({ results: ["(pass) sentinel"], exitCode: 0 });
    });
  });
});
