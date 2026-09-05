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

// The first argument's `raw` strings are spliced into the script unescaped, so
// only a template object may be accepted there. The default `$` and
// `new $.Shell()` instances each make that decision.
describe.each([
  ["$", () => $],
  ["new $.Shell()", () => new $.Shell()],
])("%s only accepts a template object as its first argument", (_, makeShell) => {
  const rejected = "threw: Please use '$' as a tagged template function: $`cmd arg1 arg2`";
  const payload = "echo pwned";

  // Not expect(() => shell(x)).toThrow(): a shell that accepts x returns a lazy ShellPromise, and
  // toThrow() would then wait for that never-started promise instead of failing.
  function callWith(first: unknown): string {
    let result: unknown;
    try {
      result = makeShell()(first as any);
    } catch (e) {
      return `threw: ${(e as Error).message}`;
    }
    return `returned ${typeof result} without throwing`;
  }

  test.each([
    ["a JSON object carrying a raw array", () => JSON.parse('{"raw":["echo pwned"]}')],
    ["an array without raw", () => [payload]],
    ["an array with raw assigned onto it", () => Object.assign([payload], { raw: [payload] })],
    ["a structuredClone of an array with raw", () => structuredClone(Object.assign([payload], { raw: [payload] }))],
    ["an array whose raw is a string", () => Object.defineProperty([payload], "raw", { value: payload })],
    [
      "an array whose raw has a different length",
      () => Object.defineProperty([payload, ""], "raw", { value: [payload] }),
    ],
    ["a string", () => payload],
    ["undefined", () => undefined],
  ])("rejects %s", (_, makeFirstArgument) => {
    expect(callWith(makeFirstArgument())).toBe(rejected);
  });

  test("rejects a raw inherited through a polluted prototype", () => {
    (Object.prototype as any).raw = [payload];
    try {
      expect([callWith({}), callWith([]), callWith(payload)]).toEqual([rejected, rejected, rejected]);
    } finally {
      delete (Object.prototype as any).raw;
    }
  });

  test("runs a template object forwarded by a wrapper", async () => {
    const shell = makeShell();
    const sh = (strings: TemplateStringsArray, ...values: string[]) => shell(strings, ...values);
    expect(await sh`echo ${"forwarded"} ${"template"}`.text()).toBe("forwarded template\n");
  });

  // What tsc's __makeTemplateObject produces for target es5: raw is defined, nothing is frozen.
  test("runs a template object built with Object.defineProperty", async () => {
    const shell = makeShell();
    const strings = Object.defineProperty(["echo ", ""], "raw", { value: ["echo ", ""] });
    expect(await shell(strings as unknown as TemplateStringsArray, "downleveled").text()).toBe("downleveled\n");
  });

  // What babel, swc and esbuild produce: raw is defined and both arrays are frozen.
  test("runs a frozen template object", async () => {
    const shell = makeShell();
    const strings = Object.freeze(Object.defineProperty(["echo ", ""], "raw", { value: Object.freeze(["echo ", ""]) }));
    expect(await shell(strings as unknown as TemplateStringsArray, "frozen").text()).toBe("frozen\n");
  });
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

  const lines = [];
  for await (const line of $`echo hello`.lines()) {
    lines.push(line);
  }

  expect(lines).toEqual(["hello", ""]);
});

test("$.arrayBuffer", async () => {
  expect(await $`echo hello`.arrayBuffer()).toEqual(new TextEncoder().encode("hello\n").buffer);
});

test("$.bytes", async () => {
  expect(await $`echo hello`.bytes()).toEqual(new TextEncoder().encode("hello\n"));
});

test("$.blob", async () => {
  expect(await $`echo hello`.blob()).toEqual(new Blob([new TextEncoder().encode("hello\n")]));
});

function make(expected: unknown) {
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
