import { spawn } from "bun";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

describe("Websocket test", () => {
  test("Handle calling ", async () => {
    const fixturePath = path.join(import.meta.dir, "bun-ws-invalid-path.fixture.js");

    const {
      exited,
      stdout: stdoutStream,
      stderr: stderrStream,
    } = spawn({
      cmd: [bunExe(), fixturePath],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      exited,
      new Response(stdoutStream).text(),
      new Response(stderrStream).text(),
    ]);

    expect({ exitCode, stdout, stderr }).toMatchObject({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });
});
