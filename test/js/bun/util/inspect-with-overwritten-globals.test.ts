import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const globals = [
  "BigInt",
  "Boolean",
  "Date",
  "Error",
  "Function",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Reflect",
  "Set",
  "Symbol",
  "WeakMap",
];
const overwrites = {
  "a function": (name: string) => `globalThis.${name} = function () {};`,
  "undefined": (name: string) => `globalThis.${name} = undefined;`,
  "deleted": (name: string) => `delete globalThis.${name};`,
  "a getter that throws": (name: string) =>
    `defineProperty(globalThis, "${name}", { get() { throw 1; }, configurable: true });`,
};
const printed = {
  "an object with a custom inspector": `log({ [custom]() { return "mine"; } });`,
  "the same, in color": `inspect({ [custom](depth, options) { return options.stylize("mine", "string"); } }, { colors: true });`,
  "a URL": `log(url);`,
  "a Buffer": `log(buffer);`,
};

const prelude = `
const custom = Symbol.for("nodejs.util.inspect.custom"), log = console.log, inspect = Bun.inspect, defineProperty = Object.defineProperty;
const url = new URL("http://localhost/a"), buffer = Buffer.from("a"), write = process.stdout.write.bind(process.stdout);
write("");
`;

test.concurrent.each(globals)("printing with %s overwritten throws or prints; it does not crash", async name => {
  for (const [how, overwrite] of Object.entries(overwrites)) {
    for (const [what, print] of Object.entries(printed)) {
      const source = `${prelude}${overwrite(name)}\ntry { ${print} } catch { write("threw\\n"); }\nwrite("end\\n");`;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        how,
        what,
        stderr,
        lastLine: stdout.trimEnd().split("\n").at(-1),
        signalCode: proc.signalCode,
        exitCode,
      }).toEqual({
        how,
        what,
        stderr: "",
        lastLine: "end",
        signalCode: null,
        exitCode: 0,
      });
    }
  }
});
