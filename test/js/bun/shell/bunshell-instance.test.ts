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
  expect(await Array.fromAsync($`echo hello`.lines())).toEqual(["hello"]);

  const lines: string[] = [];
  for await (const line of $`echo hello`.lines()) {
    lines.push(line);
  }

  expect(lines).toEqual(["hello"]);
});

test("$.lines does not yield a trailing empty string for newline-terminated output", async () => {
  expect(await Array.fromAsync($`echo -n ${"a\nb\nc\n"}`.lines())).toEqual(["a", "b", "c"]);
});

test("$.lines keeps interior blank lines", async () => {
  expect(await Array.fromAsync($`echo -n ${"a\n\nb\n"}`.lines())).toEqual(["a", "", "b"]);
});

test("$.lines with no trailing newline", async () => {
  expect(await Array.fromAsync($`echo -n ${"a\nb\nc"}`.lines())).toEqual(["a", "b", "c"]);
});

test("$.lines with empty output yields nothing", async () => {
  expect(await Array.fromAsync($`echo -n ${""}`.lines())).toEqual([]);
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
