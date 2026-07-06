import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.write rejects a non-object this", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
for (const value of [1766, true, "str", Symbol("s"), 10n, undefined, null]) {
  let code;
  try {
    console.write.call(value);
  } catch (e) {
    code = e.code;
  }
  if (code !== "ERR_INVALID_THIS") {
    throw new Error(\`expected ERR_INVALID_THIS for \${String(value)}, got \${code}\`);
  }
}

console.write.call({}, "x");
console.write("ok");
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "xok",
    exitCode: 0,
    signalCode: null,
  });
});
