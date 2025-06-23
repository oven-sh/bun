import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { createTestBuilder } from "../test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

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

describe("yes command", async () => {
  TestBuilder.command`yes | head -n 5`
    .stdout("y\ny\ny\ny\ny\n")
    .runAsTest("default output");

  TestBuilder.command`yes xy | head -n 6`
    .stdout("xy\nxy\nxy\nxy\nxy\nxy\n")
    .runAsTest("custom expletive");

  TestBuilder.command`yes ab cd ef | head -n 6`
    .stdout("ab\nab\nab\nab\nab\nab\n")
    .runAsTest("ignores extra args");
});
