import { describe, expect, test } from "bun:test";

import { $ } from "bun";
import { bunEnv, bunExe } from "harness";

test("new $.Shell() inherits process.env and throws on non-zero exit by default", async () => {
  // Run in a subprocess so other tests mutating $.env / $.throws don't interfere.
  const src = `
    import { $ } from "bun";
    const inst = new $.Shell();

    const fromDefault = (await $\`echo \$BUN_SHELL_INSTANCE_MARKER\`.quiet()).stdout.toString().trim();
    const fromFresh = (await inst\`echo \$BUN_SHELL_INSTANCE_MARKER\`.quiet()).stdout.toString().trim();

    let threwDefault, threwFresh;
    try { await $\`false\`.quiet(); } catch (e) { threwDefault = { isShellError: e instanceof $.ShellError, exitCode: e.exitCode }; }
    try { await inst\`false\`.quiet(); } catch (e) { threwFresh = { isShellError: e instanceof $.ShellError, exitCode: e.exitCode }; }

    console.log(JSON.stringify({ fromDefault, fromFresh, threwDefault, threwFresh }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, BUN_SHELL_INSTANCE_MARKER: "hello" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    fromDefault: "hello",
    fromFresh: "hello",
    threwDefault: { isShellError: true, exitCode: 1 },
    threwFresh: { isShellError: true, exitCode: 1 },
  });
  expect(exitCode).toBe(0);
});

test("$$", async () => {
  const $$ = new $.Shell();
  $$.env({ BUN: "bun" });

  expect((await $$`echo $BUN`).stdout.toString()).toBe("bun\n");

  // should not impact the parent
  expect((await $`echo $BUN`).stdout.toString()).toBe("\n");

  $.env({ BUN: "bun2" });

  // should not impact the child
  expect((await $$`echo $BUN`).stdout.toString()).toBe("bun\n");

  expect((await $`echo $BUN`).stdout.toString()).toBe("bun2\n");
});

test("new (class extends $.Shell) returns an instance of the subclass", async () => {
  class GreetingShell extends $.Shell {
    greet(name: string) {
      return this`echo $GREETING ${name}`.text();
    }
  }

  const $$ = new GreetingShell();
  expect(Object.getPrototypeOf($$)).toBe(GreetingShell.prototype);
  expect($$).toBeInstanceOf($.Shell);

  $$.env({ GREETING: "hello" });
  expect(await $$.greet("bun")).toBe("hello bun\n");
});

// The strings of the first argument's `raw` go into the script unescaped.
describe.each(["$", "new $.Shell()"] as const)("the first argument of %s", shellSource => {
  type AnyShell = (...args: unknown[]) => $.ShellPromise;
  const makeShell = () => (shellSource === "$" ? $ : new $.Shell()) as unknown as AnyShell;
  const notATemplate = "Error: Please use '$' as a tagged template function: $`cmd arg1 arg2`";

  // Not expect(() => shell(x)).toThrow(): a shell that takes x returns a lazy ShellPromise, and toThrow() waits for it.
  function callWith(...args: unknown[]): string {
    let result: object;
    try {
      result = makeShell()(...args);
    } catch (e) {
      return `${(e as Error).constructor.name}: ${(e as Error).message}`;
    }
    return `returned a ${result.constructor.name}`;
  }

  test.concurrent("does not take `raw` from a polluted prototype", async () => {
    const src = `
      import { $ } from "bun";
      const shell = ${shellSource};
      const prototypes = [Object.prototype, Array.prototype, String.prototype];
      for (const prototype of prototypes) prototype.raw = ["echo pwned"];

      const outcomes = {};
      for (const [name, first] of [["object", {}], ["string", "echo hi"], ["number", 5], ["array", []]]) {
        let promise;
        try {
          promise = shell(first);
        } catch (e) {
          outcomes[name] = e.constructor.name + ": " + e.message;
          continue;
        }
        outcomes[name] = "ran: " + (await promise.quiet().text());
      }

      for (const prototype of prototypes) delete prototype.raw;
      console.log(JSON.stringify(outcomes));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        JSON.stringify({ object: notATemplate, string: notATemplate, number: notATemplate, array: notATemplate }) +
        "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    [
      "a getter on the prototype of a class instance",
      () =>
        new (class {
          get raw() {
            return ["echo pwned"];
          }
        })(),
    ],
    ["an object created from one that has `raw`", () => Object.create({ raw: ["echo pwned"] })],
    [
      "a Proxy that answers `raw` from its get trap only",
      () => new Proxy({}, { get: (_, key) => (key === "raw" ? ["echo pwned"] : undefined) }),
    ],
  ])("does not take `raw` from %s", (_, makeFirst) => {
    expect(callWith(makeFirst())).toBe(notATemplate);
  });

  test("asks a Proxy for its own `raw`, not through its get trap", async () => {
    const first = new Proxy(
      { raw: ["echo own"] },
      { get: (target, key) => (key === "raw" ? ["echo trap"] : Reflect.get(target, key)) },
    );
    expect(await makeShell()(first).text()).toBe("own\n");
  });

  test("reads an own `raw` once", () => {
    let reads = 0;
    const first = {
      get raw() {
        reads++;
        return ["echo ok"];
      },
    };
    expect({ outcome: callWith(first), reads }).toEqual({ outcome: "returned a ShellPromise", reads: 1 });
  });

  // Hand-built first arguments that run today: these keep running.
  test.each([
    ["a template object passed on by a wrapper", () => ((strings: TemplateStringsArray) => strings)`echo ok`],
    [
      "a frozen array with a non-enumerable `raw`",
      () => Object.freeze(Object.defineProperty(["echo ok"], "raw", { value: Object.freeze(["echo ok"]) })),
    ],
    ["an array with `raw` assigned onto it", () => Object.assign(["echo ok"], { raw: ["echo ok"] })],
    ["an object with its own `raw`", () => ({ raw: ["echo ok"] })],
  ])("runs %s", async (_, makeFirst) => {
    expect(await makeShell()(makeFirst()).text()).toBe("ok\n");
  });

  // A global object answers through a proxy. Before oven-sh/WebKit#1048 the interpreter cached the own read
  // of one, and the second call read another cell: a crash, or the text of another property.
  test.concurrent.each([
    ["globalThis", `globalThis.raw = ["echo own"]; const first = globalThis;`],
    [
      "the global of a node:vm context",
      `const first = vm.runInContext("globalThis", vm.createContext({ raw: ["echo own"], length: 1, 0: "echo other" }));`,
    ],
    [
      "a node:vm global that is not contextified",
      `const first = vm.runInContext("this", vm.createContext(vm.constants.DONT_CONTEXTIFY)); first.raw = ["echo own"];`,
    ],
  ])("runs the own `raw` of %s on every call", async (_, setup) => {
    const src = `
      import { $ } from "bun";
      import vm from "node:vm";
      const shell = ${shellSource};
      ${setup}
      const outputs = [];
      for (let i = 0; i < 4; i++) outputs.push(await shell(first).text());
      console.log(JSON.stringify(outputs));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: JSON.stringify(["own\n", "own\n", "own\n", "own\n"]) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("throws the same Error for a missing, undefined or null first argument", () => {
    expect([callWith(), callWith(undefined), callWith(null)]).toEqual([notATemplate, notATemplate, notATemplate]);
  });

  test("rejects the first argument before it reads an interpolated value", () => {
    let read = false;
    const value = {
      toString() {
        read = true;
        return "x";
      },
    };
    expect({ outcome: callWith({}, value), read }).toEqual({ outcome: notATemplate, read: false });
  });
});

test("$.text", async () => {
  expect(await $`echo hello`.text()).toBe("hello\n");
});

test("$.json", async () => {
  expect(await $`echo '{"hello": 123}'`.json()).toEqual({ hello: 123 });
});

test("$.json", async () => {
  expect(await $`echo '{"hello": 123}'`.json()).toEqual({ hello: 123 });
});

test("$.lines", async () => {
  expect(await Array.fromAsync(await $`echo hello`.lines())).toEqual(["hello", ""]);

  const lines: string[] = [];
  for await (const line of $`echo hello`.lines()) {
    lines.push(line);
  }

  expect(lines).toEqual(["hello", ""]);
});

test("$.arrayBuffer", async () => {
  expect(await $`echo hello`.arrayBuffer()).toEqual(new TextEncoder().encode("hello\n").buffer);
});

test("$.bytes", async () => {
  expect(await ($`echo hello` as any).bytes()).toEqual(new TextEncoder().encode("hello\n"));
});

test("$.blob", async () => {
  expect(await $`echo hello`.blob()).toEqual(new Blob([new TextEncoder().encode("hello\n")]));
});

function make(expected: string) {
  const inputType = [
    new Blob([expected]),
    Buffer.from(expected),
    new TextEncoder().encode(expected),
    new Response(expected),
  ];

  for (let data of inputType) {
    test(`$(cat < ${data.constructor.name}).text()`, async () => {
      expect(await $`cat < ${data}`.text()).toEqual(expected);
    });

    if (ArrayBuffer.isView(data)) {
      test(`$(cat hello > ${data.constructor.name}).text() passes`, async () => {
        await $`cat ${import.meta.path} > ${data}`.quiet();
        const out = await $`cat ${import.meta.path}`.arrayBuffer();
        expect(data.subarray(0, out.byteLength)).toEqual(new Uint8Array(out));
      });

      // TODO: if the buffer is not sufficiently large, this will hang forever
    } else {
      test(`$(cat hello > ${data.constructor.name}).text() fails`, async () => {
        expect(async () => await $`cat ${import.meta.path} > ${data}`.text()).toThrow();
      });
    }
  }
}

describe("hello world!.repeat(9000)", () => {
  make("hello world!".repeat(9000));
});
