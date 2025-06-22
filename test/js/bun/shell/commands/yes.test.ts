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

describe("yes - event loop task processing", async () => {
  TestBuilder.command`yes | head -3`
    .exitCode(0)
    .stdout("y\ny\ny\n")
    .stderr("")
    .runAsTest("basic yes with head - tests YesTask event loop processing");

  TestBuilder.command`yes hello | head -2`
    .exitCode(0)
    .stdout("hello\nhello\n")
    .stderr("")
    .runAsTest("custom string yes with head - tests YesTask with custom output");

  TestBuilder.command`timeout 0.1 yes`
    .exitCode(124)
    .stdout((stdout) => {
      expect(stdout.length).toBeGreaterThan(0);
      expect(stdout.split('\n').filter(line => line === 'y').length).toBeGreaterThan(0);
    })
    .stderr("")
    .runAsTest("yes with timeout - tests YesTask cancellation in event loop");

  TestBuilder.command`yes test | head -1000 | wc -l`
    .exitCode(0)
    .stdout("1000\n")
    .stderr("")
    .runAsTest("high volume yes output - tests YesTask event loop stability");
});
