import { bunEnv, bunExe } from "harness";

test.each(["stdin_fell_asleep.js", "stdin_fell_asleep_2.js"])("make sure stdin wakes up (%s)", async file => {
  const res = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/" + file],
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // wait for ready signal from stdin
  {
    const reader = res.stdout.getReader();
    await reader.read();
    reader.releaseLock();
  }
  // send a message
  await res.stdin.write("Hello, world!\n");
  await res.exited;
  let stdout = "";
  let stderr = "";
  for await (const chunk of res.stdout) {
    stdout += new TextDecoder().decode(chunk);
  }
  for await (const chunk of res.stderr) {
    stderr += new TextDecoder().decode(chunk);
  }
  expect({
    exitCode: res.exitCode,
    stdout: stdout.trim(),
    stderr,
  }).toStrictEqual({
    exitCode: 0,
    stdout: JSON.stringify("Hello, world!\n"),
    stderr: "",
  });
});
