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

// $.env() sets the default that $`cmd`.env() sets for one command, so both take the same values: any object.
describe("$.env() argument validation", () => {
  const error = expect.objectContaining({ name: "TypeError", message: "env must be an object or undefined" });

  // `undefined` is not in this list: it restores process.env.
  describe.each([5, 0, NaN, 1n, "str", "", true, false, null, Symbol("env")])("%p is not an object", value => {
    test("new $.Shell().env() throws and keeps the previous env", async () => {
      const $$ = new $.Shell();
      $$.env({ BUN: "bun" });

      // @ts-expect-error
      expect(() => $$.env(value)).toThrow(error);
      expect(await $$`echo $BUN`.text()).toBe("bun\n");
    });

    test("$.env() throws", () => {
      // @ts-expect-error
      expect(() => $.env(value)).toThrow(error);
    });

    test("$`cmd`.env() throws", () => {
      // A block body keeps expect() from waiting on the returned ShellPromise, which never starts.
      expect(() => {
        // @ts-expect-error
        $`true`.env(value);
      }).toThrow("env must be an object");
    });
  });

  // Each value is in its own array, because describe.each() spreads an array row into arguments.
  describe.each([[{}], [Object.create(null)], [[]], [new Map()], [() => {}]])("%p is an object", value => {
    test("new $.Shell().env() accepts it", () => {
      const $$ = new $.Shell();
      expect(() => $$.env(value)).not.toThrow();
    });

    test("$`cmd`.env() accepts it", () => {
      expect(() => {
        $`true`.env(value);
      }).not.toThrow();
    });
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
