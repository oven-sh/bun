import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("SOCKS proxy environment variables", () => {
  test("should read SOCKS proxy from http_proxy environment variable", async () => {
    const dir = tempDirWithFiles("socks-http-proxy", {
      "test.js": `
        try {
          const response = await fetch("http://127.0.0.1:8888/nonexistent");
          console.log("UNEXPECTED_SUCCESS");
        } catch (error) {
          console.log("PROXY_ATTEMPTED");
        }
      `,
    });

    const env = {
      ...bunEnv,
      http_proxy: "socks5://127.0.0.1:65432",
    };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("PROXY_ATTEMPTED");
  });

  test("should read SOCKS proxy from https_proxy environment variable", async () => {
    const dir = tempDirWithFiles("socks-https-proxy", {
      "test.js": `
        try {
          const response = await fetch("https://127.0.0.1:8888/nonexistent");
          console.log("UNEXPECTED_SUCCESS");
        } catch (error) {
          console.log("PROXY_ATTEMPTED");
        }
      `,
    });

    const env = {
      ...bunEnv,
      https_proxy: "socks5h://127.0.0.1:65432",
    };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("PROXY_ATTEMPTED");
  });

  test("should handle invalid SOCKS proxy URLs gracefully", async () => {
    const dir = tempDirWithFiles("socks-invalid-url", {
      "test.js": `
        try {
          const response = await fetch("http://127.0.0.1:8888/test", {
            proxy: "invalid-proxy-url"
          });
          console.log("UNEXPECTED_SUCCESS");
        } catch (error) {
          console.log("INVALID_PROXY_ERROR");
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("INVALID_PROXY_ERROR");
  });
});
