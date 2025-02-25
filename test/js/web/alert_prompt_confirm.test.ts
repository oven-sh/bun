import { bunEnv, bunExe } from "harness";
import { $ } from "bun";

const commands: [js: string, stdout_before: string, tests: [input: string | undefined, stdout_after: string][]][] = [
  [
    `alert("AlertMsg")`,
    "AlertMsg [Enter] ",
    [
      ["\n", "undefined\n"],
      ["abc\n", "undefined\n"],
      ["hello\r\n", "undefined\n"],
      [undefined, "undefined\n"],
    ],
  ],
  [
    `prompt("PromptMsg")`,
    "PromptMsg ",
    [
      ["\n", "null\n"],
      ["abc\n", "abc\n"],
      ["hello\r\n", "hello\n"],
      [undefined, "null\n"],
    ],
  ],
  [
    `confirm("ConfirmMsg")`,
    "ConfirmMsg [y/N] ",
    [
      ["\n", "false\n"],
      ["y\n", "true\n"],
      ["n\n", "false\n"],
      ["whatever\n", "false\n"],
      ["Y\n", "true\n"],
      ["Y\r\n", "true\n"],
      ["yes\n", "false\n"],
      ["yeah no\n", "false\n"],
      [undefined, "false\n"],
    ],
  ],
];

for (const [js, stdout_before, tests] of commands) {
  describe(js, () => {
    for (const [input, stdout_after] of tests) {
      it(`${JSON.stringify(input)} -> ${JSON.stringify(stdout_after)}`, async () => {
        const result = await Bun.spawn({
          cmd: [bunExe(), "-e", "console.log(" + js + ")"],
          stdio: ["pipe", "pipe", "inherit"],
          env: bunEnv,
        });
        const reader = result.stdout.getReader();
        await expectStdout(reader, stdout_before);
        if (input) {
          result.stdin.write(input);
        } else {
          await result.stdin.end();
        }
        await expectStdout(reader, stdout_after);
        await result.exited;
        expect(result.exitCode).toBe(0);
      });
    }
  });
}

const all_at_once_script = commands
  .flatMap(([js, stdout_before, tests]) =>
    tests.filter(t => t[0] != null).map(([input, stdout_after]) => `console.log(${js});await Bun.sleep(0);`),
  )
  .join("\n");

async function expectStdout(reader: ReadableStreamDefaultReader<Uint8Array>, value: string) {
  let chunk_1 = await reader.read();
  expect(chunk_1.done).toBe(false);
  let dec = new TextDecoder().decode(chunk_1.value);
  while (value.startsWith(dec)) {
    value = value.substring(dec.length);
    if (value.length === 0) break;
    chunk_1 = await reader.read();
    expect(chunk_1.done).toBe(false);
    dec = new TextDecoder().decode(chunk_1.value);
  }
}

test("all at once", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "-e", all_at_once_script],
    stdio: ["pipe", "pipe", "inherit"],
    env: bunEnv,
  });
  const reader = result.stdout.getReader();
  for (const [js, stdout_before, tests] of commands) {
    for (const [input, stdout_after] of tests) {
      if (input == null) continue;
      await expectStdout(reader, stdout_before);
      if (input) {
        result.stdin.write(input);
      } else {
        await result.stdin.end();
      }
      await expectStdout(reader, stdout_after);
    }
  }
  await result.exited;
  expect(result.exitCode).toBe(0);
});

test("all at once, from bun shell", async () => {
  let stdin = commands
    .flatMap(([js, stdout_before, tests]) => tests.filter(t => t[0] != null).map(([input, stdout_after]) => input))
    .join("");

  const result = await $`echo ${stdin} | ${bunExe()} -e ${all_at_once_script}`.text();
  expect(result.split("\n")).toStrictEqual(
    commands
      .flatMap(([js, stdout_before, tests]) =>
        tests.filter(t => t[0] != null).map(([input, stdout_after]) => stdout_before + stdout_after),
      )
      .join("")
      .split("\n"),
  );
});
