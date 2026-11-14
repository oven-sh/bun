// One operation on process.stdout, process.stderr or process.stdin, and nothing else that touches the stream. A program that asks a standard stream for a few members alone gets a light stream in its
// executable: a proxy, each of whose other traps calls for the whole stream. So the compiler has to see every operation that reaches a trap. Once `key in process.stdout` ended the process: `in` under a
// key that the build does not know only looks at its operand. A program with two operations shows nothing: the second brings the whole stream.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const key = `(process.argv[2] ?? "fd")`;
const nameOfMethod = `(process.argv[2] ?? "write")`;
// For what changes the stream: without its descriptor the input stream fails when the process ends.
const spareKey = `(process.argv[2] ?? "shelf")`;

// STREAM is the stream, OTHER another one, NAME its name on `process`.
const values: Record<string, string> = {
  "in-under-a-key": `${key} in STREAM`,
  "read-under-a-key": `STREAM[${key}]`,
  "optional-read-under-a-key": `STREAM?.[${key}]`,
  "typeof-under-a-key": `typeof STREAM[${key}]`,
  "store-under-a-key": `(STREAM[${spareKey}] = 1)`,
  "delete-under-a-key": `delete STREAM[${spareKey}]`,
  "call-under-a-key": `STREAM[${nameOfMethod}]("a line\\n")`,
  "optional-call-under-a-key": `STREAM[${nameOfMethod}]?.("a line\\n")`,
  "update-under-a-key": `STREAM[${spareKey}]++`,
  "in-under-a-served-name": `"fd" in STREAM`,
  "in-under-another-name": `"shelf" in STREAM`,
  "store-under-a-served-name": `(STREAM.isTTY = false)`,
  "delete-under-a-served-name": `delete STREAM.isTTY`,
  "update-under-a-served-name": `STREAM.fd++`,
  "assigned-if-nullish-under-a-served-name": `(STREAM.columns ??= 5)`,
  "read-of-another-name": `STREAM.shelf`,
  "read-of-constructor": `typeof STREAM.constructor`,
  "read-of-proto": `typeof STREAM.__proto__`,
  "call-of-to-string": `STREAM.toString()`,
  "call-of-value-of": `typeof STREAM.valueOf()`,
  "call-of-has-own-property": `STREAM.hasOwnProperty("fd")`,
  "write-compared": `STREAM.write === OTHER.write`,
  "write-asked-its-name": `STREAM.write?.name`,
  "write-asked-its-length": `STREAM.write?.length`,
  "write-by-call": `STREAM.write.call(STREAM, "a line\\n")`,
  "write-by-apply": `STREAM.write.apply(STREAM, ["a line\\n"])`,
  "write-bound": `STREAM.write.bind(STREAM)("a line\\n")`,
  "write-optional": `STREAM.write?.("a line\\n")`,
  "write-as-a-tag": "STREAM.write`a line\\n`",
  "write-constructed": `typeof new STREAM.write("a line\\n")`,
  "write-typeof": `typeof STREAM.write`,
  "write-spread": `STREAM.write(...["a line\\n"])`,
  typeof: `typeof STREAM`,
  not: `!STREAM`,
  void: `void STREAM`,
  "same-as-itself": `STREAM === STREAM`,
  "same-as-the-other": `STREAM === OTHER`,
  "loosely-null": `STREAM == null`,
  "loosely-a-text": `STREAM == "[object Object]"`,
  "loosely-a-number": `STREAM == 1`,
  "less-than": `STREAM < 1`,
  "plus-a-text": `STREAM + ""`,
  "unary-plus": `+STREAM`,
  "in-a-template": "`${STREAM}`",
  nullish: `typeof (STREAM ?? 1)`,
  or: `typeof (STREAM || 1)`,
  and: `STREAM && 1`,
  conditional: `STREAM ? 1 : 2`,
  "instanceof-object": `STREAM instanceof Object`,
  "instanceof-function": `STREAM instanceof Function`,
  "right-of-instanceof": `({}) instanceof STREAM`,
  called: `STREAM()`,
  constructed: `new STREAM()`,
  "spread-into-an-object": `typeof { ...STREAM }.fd`,
  "spread-into-a-list": `[...STREAM].length`,
  "in-a-list": `[STREAM].length`,
  "in-a-list-and-read": `[STREAM][0].fd`,
  "in-a-literal-and-read": `({ stream: STREAM }).stream.fd`,
  "out-of-a-closure": `(() => STREAM)().fd`,
  "through-the-global-object": `globalThis.process.NAME.fd`,
  "process-under-a-written-key": `process["NAME"].fd`,
  "process-under-a-key": `process[process.argv[2] ?? "NAME"].fd`,
  "optional-chains": `process?.NAME?.fd`,
};

const statements: Record<string, string> = {
  "pattern-under-a-key": `const { [${key}]: found } = STREAM;\n  console.log(String(found));`,
  "pattern-of-served-names": `const { fd, isTTY } = STREAM;\n  console.log(fd, isTTY);`,
  "pattern-with-a-rest": `const { fd, ...others } = STREAM;\n  console.log(fd, typeof others);`,
  "pattern-with-a-default": `const { shelf = 3 } = STREAM;\n  console.log(shelf);`,
  "write-taken-off": `const { write } = STREAM;\n  console.log(String(write("a line\\n")));`,
  "write-in-a-variable": `const write = STREAM.write;\n  console.log(String(write.call(STREAM, "a line\\n")));`,
  extended: `class Shelf extends STREAM {}\n  console.log(typeof Shelf);`,
  awaited: `console.log(typeof (await STREAM));`,
  thrown: `try {\n    throw STREAM;\n  } catch (caught) {\n    console.log(caught.fd);\n  }`,
  "switched-on": `switch (STREAM) {\n    case OTHER:\n      console.log("the other");\n      break;\n    default:\n      console.log("itself");\n  }`,
  "for-in": `let count = 0;\n  for (const name in STREAM) count++;\n  console.log(count > 3);`,
  "for-of": `for (const each of STREAM) console.log(each);`,
  "list-pattern": `const [first] = STREAM;\n  console.log(first);`,
  "in-a-constant": `const stream = STREAM;\n  console.log(stream.fd);`,
  "in-a-variable-that-changes": `let stream = STREAM;\n  if (process.argv.length > 5) stream = OTHER;\n  console.log(stream.fd);`,
  "handed-to-a-function": `function tell(stream) {\n    return stream.fd;\n  }\n  console.log(tell(STREAM));`,
  "a-private-name-is-tested": `class Shelf {\n    #board = 1;\n    static has(value) {\n      return #board in value;\n    }\n  }\n  console.log(Shelf.has(STREAM));`,
  yielded: `function* hand() {\n    yield STREAM;\n  }\n  for (const stream of hand()) console.log(stream.fd);`,
  "a-pattern-on-process": `const { NAME } = process;\n  console.log(NAME.fd);`,
  "a-deep-pattern-on-process": `const {\n    NAME: { fd },\n  } = process;\n  console.log(fd);`,
  "a-late-import-of-node-process": `const host = await import("node:process");\n  console.log(host.NAME.fd);`,
};

const imported: Record<string, [head: string, value: string]> = {
  "the-default-of-node-process": [`import host from "node:process";`, `host.NAME.fd`],
  "a-name-of-node-process": [`import { NAME } from "node:process";`, `NAME.fd`],
  "the-star-of-node-process": [`import * as host from "node:process";`, `host.NAME.fd`],
};

// The message of an error quotes the text of the program, which plain Bun has rewritten by then.
const guarded = (text: string) => `try {\n  ${text}\n} catch (error) {\n  console.log(error.name);\n}\n`;

export default function write(folder: string) {
  const programs: [name: string, text: string][] = [
    ...Object.entries(values).map(([name, value]): [string, string] => [
      name,
      guarded(`console.log(String(${value}));`),
    ]),
    ...Object.entries(statements).map(([name, text]): [string, string] => [name, guarded(text)]),
    ...Object.entries(imported).map(([name, [head, value]]): [string, string] => [
      name,
      `${head}\n${guarded(`console.log(String(${value}));`)}`,
    ]),
  ];
  for (const [stream, other] of [
    ["stdout", "stderr"],
    ["stderr", "stdout"],
    ["stdin", "stdout"],
  ])
    for (const [name, text] of programs)
      writeFileSync(
        join(folder, `${stream}--${name}.mjs`),
        "// Closed alone\n" +
          text
            .replaceAll("STREAM", `process.${stream}`)
            .replaceAll("OTHER", `process.${other}`)
            .replaceAll("NAME", stream),
      );
}
