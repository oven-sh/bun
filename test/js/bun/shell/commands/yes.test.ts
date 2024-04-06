import { $, ShellOutput } from "bun";
import { describe, test, expect, beforeEach } from "bun:test";

$.throws(false);

describe("yes", async () => {
  test("can pipe to a buffer", async () => {
    const buffer = Buffer.alloc(10);
    await $`yes > ${buffer}`;
    expect(buffer.toString()).toEqual("y\ny\ny\ny\ny\n");
  });

  test("can be overwritten by the first argument", async () => {
    const buffer = Buffer.alloc(18);
    await $`yes xy > ${buffer}`;
    expect(buffer.toString()).toEqual("xy\nxy\nxy\nxy\nxy\nxy\n");
  });

  test("ignores other arguments", async () => {
    const buffer = Buffer.alloc(17);
    await $`yes ab cd ef > ${buffer}`;
    expect(buffer.toString()).toEqual("ab\nab\nab\nab\nab\nab");
  });
});
