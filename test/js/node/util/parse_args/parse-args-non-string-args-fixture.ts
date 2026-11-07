// For each case, prints one line of JSON with what parseArgs gives for a string. Then prints one
// line for each kind of `args` element that converts to that string once and to another string
// afterwards: the number of conversions, and what parseArgs gives for the element.
import { parseArgs } from "node:util";

const B = { type: "boolean" } as const;
const S = { type: "string" } as const;

const tokens = (arg: unknown) => parseArgs({ args: [arg as string], strict: false, tokens: true });
const strict = (arg: unknown) => parseArgs({ args: [arg as string] });

// name: [the first string, the string of every later conversion (or an Error to throw), the call]
const cases: Record<string, [string, string | Error, (arg: any) => unknown]> = {
  "tokens, --name=value, later string has '=' at another index": ["--foo=bar", "--fo=o=bar", tokens],
  "tokens, --name=value, later conversion throws": ["--foo=bar", new Error("converted again"), tokens],

  // A second conversion made the process abort in each of the cases below.
  "tokens, --name=value": ["--foo=bar", "nothing", tokens],
  "tokens, UTF-16 --name=value": ["--日本=値", "x", tokens],
  "tokens, Latin-1 --name=value": ["--fôo=bär", "日", tokens],
  "tokens, short option group": ["-abc", "-a", tokens],
  "tokens, UTF-16 short option group": ["-a日é", "-a", tokens],
  "tokens, string option inside a short option group": [
    "-afX",
    "-a",
    arg => parseArgs({ args: [arg], options: { a: B, f: S }, tokens: true }),
  ],
  "strict, unknown --name=value": ["--foo=bar", "nothing", strict],
  "strict, unknown --name=value, later string is empty": ["--a=b", "", strict],
  "strict, unknown UTF-16 --name=value": ["--日本=値", "", strict],
  "strict, unknown option in a short option group": ["-ab", "-a", arg => parseArgs({ args: [arg], options: { a: B } })],
  "strict, ambiguous value after a short option group": [
    "-af",
    "-a",
    arg => parseArgs({ args: [arg, "-x"], options: { a: B, f: S } }),
  ],
  "args omitted, element in process.argv": [
    "--foo=bar",
    "nothing",
    arg => {
      process.argv.push(arg);
      try {
        return parseArgs({ strict: false, tokens: true });
      } finally {
        process.argv.pop();
      }
    },
  ],
};

// `convert` is the only way each element becomes a string.
const kinds: Record<string, (convert: () => string) => object> = {
  "object with toString": convert => ({ toString: convert }),
  "String subclass with toString": convert =>
    new (class extends String {
      toString() {
        return convert();
      }
    })("unused"),
  "array with toString": convert => Object.assign(["unused"], { toString: convert }),
  "object with Symbol.toPrimitive": convert => ({ [Symbol.toPrimitive]: convert }),
  "object with valueOf": convert => ({ __proto__: null, valueOf: convert }),
};

function outcome(call: () => unknown) {
  try {
    return { result: call() };
  } catch (error: any) {
    return { error: { code: error.code, message: error.message } };
  }
}

for (const [name, [first, later, call]] of Object.entries(cases)) {
  console.log(JSON.stringify({ case: name, ...outcome(() => call(first)) }));

  for (const [kind, make] of Object.entries(kinds)) {
    let conversions = 0;
    const element = make(() => {
      if (conversions++ === 0) return first;
      if (later instanceof Error) throw later;
      return later;
    });
    const line = { case: name, kind, ...outcome(() => call(element)), conversions };
    console.log(JSON.stringify(line));
  }
}
