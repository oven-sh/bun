import { bunExe } from "harness";

test("order", async () => {
  const res = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dir + "/order-fixture.js"],
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect({
    stdout: res.stdout.toString().replaceAll("\r", ""),
    stderr: res.stderr.toString().replaceAll("\r", ""),
    exitCode: res.exitCode,
  }).toEqual({
    stdout: "l1\nl2\nl3\n",
    stderr: "",
    exitCode: 0,
  });
});

test("exit", async () => {
  const res = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dir + "/exit-fixture.js"],
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect({
    stdout: res.stdout.toString().replaceAll("\r", ""),
    stderr: res.stderr.toString().replaceAll("\r", ""),
    exitCode: res.exitCode,
  }).toEqual({
    stdout: "l1\nl2\n",
    stderr: "",
    exitCode: 0,
  });
});
