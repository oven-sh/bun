import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// No case asks a stream for more than `fd` and `write`. The modules behind a standard stream call Object.getPrototypeOf when
// they load (node:events), and Reflect.ownKeys when they are used (node:events, internal/streams/legacy). A replaced
// Object.getPrototypeOf that answers nonsense makes the load throw. node:child_process loads node:events too: a case about
// it alone replaces Reflect.ownKeys, which its load does not call.
const project = casesOfOneRun("the-first-read-of-a-standard-stream-calls-what-a-test-has-replaced", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

function runsAsPlain(title: string, expected: string, body: string, replaced = "Object.getPrototypeOf") {
  const name = project.add(
    name => `
      import { spyOn, test } from "bun:test";
      ${sayOf(name)}
      const real = ${replaced};
      const nonsense = () => undefined;
      test("${name}", () => {
        try {${body.replaceAll("console.log(", "say(").replaceAll("REPLACED", replaced)}
        } catch (error) {
          ${replaced} = real;
          say("threw", error.name);
        } finally {
          ${replaced} = real;
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
    `process.${stream}.write() calls an Object.getPrototypeOf that counts`,
    "true true",
    `
          let calls = 0;
          REPLACED = object => (calls++, real(object));
          const written = process.${stream}.write("");
          REPLACED = real;
          console.log(written, calls > 0);`,
  );
  runsAsPlain(
    `process.${stream} is undefined behind an Object.getPrototypeOf that its modules throw on`,
    "undefined",
    `
          REPLACED = nonsense;
          const kind = typeof process.${stream};
          REPLACED = real;
          console.log(kind);`,
  );
  runsAsPlain(
    `process.${stream}.write() throws behind an Object.getPrototypeOf that its modules throw on`,
    "threw TypeError",
    `
          REPLACED = nonsense;
          console.log(process.${stream}.write(""));`,
  );
}

runsAsPlain(
  "process.stdin.fd calls an Object.getPrototypeOf that counts",
  "0 true",
  `
          let calls = 0;
          REPLACED = object => (calls++, real(object));
          const fd = process.stdin.fd;
          REPLACED = real;
          console.log(fd, calls > 0);`,
);

runsAsPlain(
  "process.stdin is undefined behind an Object.getPrototypeOf that its modules throw on",
  "undefined",
  `
          REPLACED = nonsense;
          const kind = typeof process.stdin;
          REPLACED = real;
          console.log(kind);`,
);

runsAsPlain(
  "a spy on Object.getPrototypeOf hears the first write",
  "true",
  `
          const spy = spyOn(Object, "getPrototypeOf");
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
          REPLACED = nonsense;
          console.log(String(require("node:child_process").execSync("echo ex")));`,
);

runsAsPlain(
  "execSync() with the streams of the child named reads no stream of its own",
  "ex",
  `
          REPLACED = nonsense;
          console.log(String(require("node:child_process").execSync("echo ex", { stdio: "pipe" })).trim());`,
  "Reflect.ownKeys",
);
