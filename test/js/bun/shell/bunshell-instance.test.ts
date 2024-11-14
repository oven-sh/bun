import { describe, expect, test } from "bun:test";

import { $ } from "bun";

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
