import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// No case asks a stream for more than `fd` and `write`.
const project = casesOfOneRun("the-first-read-of-a-standard-stream-calls-what-a-test-has-replaced", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

function runsAsPlain(title: string, expected: string, body: string) {
  const name = project.add(
    name => `
      import { spyOn, test } from "bun:test";
      ${sayOf(name)}
      const keys = Object.keys;
      const nonsense = () => ["nonsense"];
      test("${name}", () => {
        try {${body.replaceAll("console.log(", "say(")}
        } catch (error) {
          Object.keys = keys;
          say("threw", error.name);
        } finally {
          Object.keys = keys;
        }
      });`,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.printed).toBe(expected + "\n");
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
    expect((await project.ran(["--debug-aot"], "TestRunLayers:0")).get(name)).toEqual(plain);
  });
}

for (const stream of ["stdout", "stderr"]) {
  runsAsPlain(
    `process.${stream}.write() calls an Object.keys that counts`,
    "true true",
    `
          let calls = 0;
          Object.keys = object => (calls++, keys(object));
          const written = process.${stream}.write("");
          Object.keys = keys;
          console.log(written, calls > 0);`,
  );
  runsAsPlain(
    `process.${stream} is undefined behind an Object.keys that its modules throw on`,
    "undefined",
    `
          Object.keys = nonsense;
          const kind = typeof process.${stream};
          Object.keys = keys;
          console.log(kind);`,
  );
  runsAsPlain(
    `process.${stream}.write() throws behind an Object.keys that its modules throw on`,
    "threw TypeError",
    `
          Object.keys = nonsense;
          console.log(process.${stream}.write(""));`,
  );
}

runsAsPlain(
  "process.stdin.fd calls an Object.keys that counts",
  "0 true",
  `
          let calls = 0;
          Object.keys = object => (calls++, keys(object));
          const fd = process.stdin.fd;
          Object.keys = keys;
          console.log(fd, calls > 0);`,
);

runsAsPlain(
  "process.stdin is undefined behind an Object.keys that its modules throw on",
  "undefined",
  `
          Object.keys = nonsense;
          const kind = typeof process.stdin;
          Object.keys = keys;
          console.log(kind);`,
);

runsAsPlain(
  "a spy on Object.keys hears the first write",
  "true",
  `
          const spy = spyOn(Object, "keys");
          process.stdout.write("");
          const heard = spy.mock.calls.length > 0;
          spy.mockRestore();
          console.log(heard);`,
);

runsAsPlain(
  "a getter that a test adds to Object.prototype is read by the first write",
  "true",
  `
          let reads = 0;
          Object.defineProperty(Object.prototype, "signal", { get() { reads++; }, configurable: true });
          try {
            process.stdout.write("");
          } finally {
            delete Object.prototype.signal;
          }
          console.log(reads > 0);`,
);

runsAsPlain(
  "execSync(), which hands on what the child wrote to its stderr",
  "threw TypeError",
  `
          Object.keys = nonsense;
          console.log(String(require("node:child_process").execSync("echo ex")));`,
);

runsAsPlain(
  "execSync() with the streams of the child named reads no stream of its own",
  "ex",
  `
          Object.keys = nonsense;
          console.log(String(require("node:child_process").execSync("echo ex", { stdio: "pipe" })).trim());`,
);
