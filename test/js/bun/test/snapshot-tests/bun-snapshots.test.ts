import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("it will create a snapshot file if it doesn't exist", () => {
  expect({ a: { b: { c: false } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Boolean) } } });
  expect({ a: { b: { c: "string" } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(String) } } });
  expect({ a: { b: { c: 4 } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Number) } } });
  expect({ a: { b: { c: 2n } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(BigInt) } } });
  expect({ a: new Date() }).toMatchSnapshot({ a: expect.any(Date) });
  expect({ j: 2, a: "any", b: "any2" }).toMatchSnapshot({ j: expect.any(Number), a: "any", b: expect.any(String) });
  expect({ j: /regex/, a: "any", b: "any2" }).toMatchSnapshot({
    j: expect.any(RegExp),
    a: "any",
    b: expect.any(String),
  });
});

test("ArrayBuffer values are serialized like typed arrays", () => {
  expect(new Uint8Array([1, 2, 3]).buffer).toMatchInlineSnapshot(`
    ArrayBuffer [
      1,
      2,
      3,
    ]
  `);
  expect({ a: 1, b: new Uint8Array([4, 5]).buffer }).toMatchInlineSnapshot(`
    {
      "a": 1,
      "b": ArrayBuffer [
        4,
        5,
      ],
    }
  `);
});

describe("toMatchSnapshot errors", () => {
  it("should throw if property matchers exist and received is not an object", () => {
    expect(() => {
      expect(1).toMatchSnapshot({ a: 1 });
    }).toThrow();
  });
  it("should throw if property matchers don't match", () => {
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: 1 });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(Date) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(String) });
    }).toThrow();
    expect(() => {
      expect({ a: 4n }).toMatchSnapshot({ a: expect.any(Number) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(BigInt) });
    }).toThrow();
  });
  it("should throw if arguments are in the wrong order", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: "oops" }).toMatchSnapshot("wrong spot", { a: "oops" });
    }).toThrow();
    expect(() => {
      expect({ a: "oops" }).toMatchSnapshot({ a: "oops" }, "right spot");
    }).not.toThrow();
  });

  it("should throw if expect.any() doesn't received a constructor", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any() });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 5 }).toMatchSnapshot({ a: expect.any(5) });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any("not a constructor") });
    }).toThrow();
  });
});

describe.concurrent("a React element in Bun's snapshot format", () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const firstLine = `const firstLine = f => { try { f(); return "passes"; } catch (error) { return error.message.split("\\n")[0]; } };`;

  async function runTests(cwd: string, env: Record<string, string>, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, CI: "true", ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const log = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
    return { log, stderr, exitCode, fail: Number(stderr.match(/^ *(\d+) fail$/m)?.[1] ?? 0) };
  }
  async function logOf(files: Record<string, string>) {
    using dir = tempDir("snapshot-only-child", files);
    return await runTests(String(dir), {});
  }

  // An older Bun printed the only child of a React element if it was a string, an element or an array, and no other child.
  // It printed a React 19 element as an object, which holds every child.
  describe.each(["react.element", "react.transitional.element"])("the only child of a %s", symbol => {
    const isReact19 = symbol === "react.transitional.element";
    const message = "expect(received).toMatchInlineSnapshot(expected)";
    const el = `
      const el = (type, props) => ({ $$typeof: Symbol.for(${JSON.stringify(symbol)}), type, key: null, ref: null, props });
      const cell = children => el("td", { children });
    `;
    const olderBun = (child: string) =>
      isReact19
        ? `\n{\n  "$$typeof": Symbol(react.transitional.element),\n  "key": null,\n  "props": {\n    "children": ${child},\n  },\n  "ref": null,\n  "type": "td",\n}\n`
        : "<td />";

    test("prints as a list of one whatever its kind, but for null and false", async () => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
            import { test, expect } from "bun:test";
            ${firstLine}
            ${el}
            test("now", () => {
              const kinds = [
                [1, "1"],
                [-0, "-0"],
                [1n, "1n"],
                [true, "true"],
                [{ a: 1 }, '{\\n    "a": 1,\\n  }'],
                [function render() {}, "[Function: render]"],
                [Symbol("s"), "Symbol(s)"],
                [new Date(0), "1970-01-01T00:00:00.000Z"],
                [expect.stringContaining("a"), "StringContaining a"],
              ];
              for (const [child, text] of kinds) {
                const printed = "<td>\\n  " + text + "\\n</td>";
                expect(cell(child)).toMatchInlineSnapshot(printed);
                expect(cell([child])).toMatchInlineSnapshot(printed);
              }
              expect({ cell: cell(1), className: el("td", { className: "x", children: 1 }) }).toMatchInlineSnapshot(\`
                {
                  "cell": <td>
                    1
                  </td>,
                  "className": <td className="x">
                    1
                  </td>,
                }
              \`);
            });
            test("another child", () => {
              const one = "<td>\\n  1\\n</td>";
              expect(cell(1)).toMatchInlineSnapshot(one);
              for (const other of [2, 1n, { a: 1 }]) console.log(firstLine(() => expect(cell(other)).toMatchInlineSnapshot(one)));
              for (const none of [null, false, undefined]) {
                try {
                  expect(cell(none)).toMatchInlineSnapshot(one);
                } catch (error) {
                  console.log(JSON.stringify(error.message.split("\\n").filter(line => /^[-+] </.test(line))));
                }
              }
            });
          `,
      });
      const noChild = JSON.stringify(["- <td>", "- </td>", "+ <td />"]);
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        log: [message, message, message, noChild, noChild, noChild],
        stderr: "",
        exitCode: 0,
      });
    });

    test("what an older Bun wrote for it passes, stays as it is, and --update-snapshots rewrites it", async () => {
      const older = header + `\nexports[\`in a file 1\`] = \`${olderBun("1")}\`;\n`;
      using dir = tempDir("snapshot-older-bun-only-child", {
        "a.test.js": `
            ${el}
            const child = Number(process.env.CHILD);
            test("in a file", () => { expect(cell(child)).toMatchSnapshot(); });
            test("inline", () => { expect(cell(child)).toMatchInlineSnapshot(\`${olderBun("1")}\`); });
          `,
        "__snapshots__/a.test.js.snap": older,
      });
      const snap = () => readFileSync(join(String(dir), "__snapshots__", "a.test.js.snap"), "utf8");
      const run = (CHILD: string, ...args: string[]) => runTests(String(dir), { CI: "true", CHILD }, ...args);

      // The `<td />` of an older Bun has no child in it, so it passes for each child until it is rewritten.
      const [same, other] = await Promise.all([run("1"), run("2")]);
      expect(snap()).toBe(older);
      expect([same.fail, other.fail]).toEqual([0, isReact19 ? 2 : 0]);

      const updated = await run("1", "--update-snapshots");
      expect(snap()).toBe(header + "\nexports[`in a file 1`] = `<td>\n  1\n</td>`;\n");
      const [read, changed] = await Promise.all([run("1"), run("2")]);
      expect([updated.fail, read.fail, changed.fail]).toEqual([0, 0, 2]);
      expect([same.exitCode, updated.exitCode, read.exitCode, changed.exitCode]).toEqual([0, 0, 0, 1]);
    });

    // No release wrote `<td />` for a React 19 element that has a child.
    test(`an entry of "<td />" ${isReact19 ? "fails" : "passes"} for an element that has a child`, async () => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
            import { test, expect } from "bun:test";
            ${firstLine}
            ${el}
            test("t", () => {
              expect(cell(1)).toMatchInlineSnapshot("<td>\\n  1\\n</td>");
              for (const child of [1, 1n, true, { a: 1 }, () => {}]) console.log(firstLine(() => expect(cell(child)).toMatchInlineSnapshot("<td />")));
            });
          `,
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        log: Array.from({ length: 5 }, () => (isReact19 ? message : "passes")),
        stderr: "",
        exitCode: 0,
      });
    });

    test("throws what it throws when it prints, as an item of a list and a prop do", async () => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
            import { test, expect } from "bun:test";
            ${firstLine}
            ${el}
            const throws = () => Object.assign(new Date(0), { toJSON() { throw new RangeError("not now"); } });
            test("in a file", () => { console.log(firstLine(() => expect(cell(throws())).toMatchSnapshot())); });
            test("inline", () => {
              for (const value of [cell(throws()), cell([throws()]), el("td", { title: throws() })]) {
                console.log(firstLine(() => expect(value).toMatchInlineSnapshot("<td />")));
              }
            });
          `,
        "__snapshots__/a.test.js.snap": header + "\nexports[`in a file 1`] = `<td />`;\n",
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        log: ["not now", "not now", "not now", "not now"],
        stderr: "",
        exitCode: 0,
      });
    });

    test("goes to a snapshot serializer as an item of a list does", async () => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
            import { test, expect } from "bun:test";
            ${firstLine}
            ${el}
            class Money { constructor(amount) { this.amount = amount; } }
            expect.addSnapshotSerializer({ test: value => value instanceof Money, serialize: value => "$" + value.amount });
            test("a serializer that prints it", () => {
              expect(cell(new Money(1))).toMatchInlineSnapshot("<td>\\n  $1\\n</td>");
              expect(cell([new Money(1)])).toMatchInlineSnapshot("<td>\\n  $1\\n</td>");
              console.log(firstLine(() => expect(cell(new Money(1))).toMatchInlineSnapshot("<td />")));
            });
            test("a serializer that throws", () => {
              expect.addSnapshotSerializer({ test: value => value === 5, serialize() { throw new RangeError("in serialize()"); } });
              for (const value of [cell(5), cell([5]), el("td", { title: 5 })]) {
                console.log(firstLine(() => expect(value).toMatchInlineSnapshot("<td />")));
              }
            });
          `,
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        log: [isReact19 ? message : "passes", "in serialize()", "in serialize()", "in serialize()"],
        stderr: "",
        exitCode: 0,
      });
    });

    test("prints the property matcher that takes its place", async () => {
      const { log, stderr, exitCode } = await logOf({
        "a.test.js": `
            import { test, expect } from "bun:test";
            ${firstLine}
            ${el}
            test("t", () => {
              const number = () => ({ props: { children: expect.any(Number) } });
              expect(cell(1)).toMatchInlineSnapshot(number(), "<td>\\n  Any<Number>\\n</td>");
              expect(cell("a")).toMatchInlineSnapshot({ props: { children: expect.stringContaining("a") } }, "<td>\\n  StringContaining a\\n</td>");
              expect(cell(1)).toMatchInlineSnapshot(number(), \`${olderBun("Any<Number>")}\`);
              console.log(firstLine(() => expect(cell("1")).toMatchInlineSnapshot(number(), \`${olderBun("Any<Number>")}\`)));
            });
          `,
      });
      expect({ log, stderr: exitCode ? stderr : "", exitCode }).toEqual({
        log: ["expect(received).toMatchInlineSnapshot(propertyMatchers)"],
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // To an older Bun a React 19 element was an object: no child that it printed, and an object in a list.
  test("what an older Bun wrote for a react.element that holds a React 19 element passes", async () => {
    const object = `{\n    "$$typeof": Symbol(react.transitional.element),\n    "key": null,\n    "props": {\n      "children": "x",\n    },\n    "ref": null,\n    "type": "b",\n  }`;
    const file = (onlyChild: string, inList: string) =>
      header + `\nexports[\`the only child 1\`] = \`${onlyChild}\`;\n\nexports[\`in a list 1\`] = \`${inList}\`;\n`;
    const older = file("<td />", `<td>\n  ${object}\n</td>`);
    using dir = tempDir("snapshot-older-bun-react-19-child", {
      "a.test.js": `
          const el = (symbol, type, children) => ({ $$typeof: Symbol.for(symbol), type, key: null, ref: null, props: { children } });
          const bold = () => el("react.transitional.element", "b", "x");
          test("the only child", () => { expect(el("react.element", "td", bold())).toMatchSnapshot(); });
          test("in a list", () => { expect(el("react.element", "td", [bold()])).toMatchSnapshot(); });
        `,
      "__snapshots__/a.test.js.snap": older,
    });
    const snap = () => readFileSync(join(String(dir), "__snapshots__", "a.test.js.snap"), "utf8");

    const read = await runTests(String(dir), {});
    expect(snap()).toBe(older);
    const updated = await runTests(String(dir), {}, "--update-snapshots");
    expect(snap()).toBe(file("<td>\n  <b>x</b>\n</td>", "<td>\n  <b>x</b>\n</td>"));
    expect([read.fail, updated.fail, read.exitCode, updated.exitCode]).toEqual([0, 0, 0, 0]);
  });
});
