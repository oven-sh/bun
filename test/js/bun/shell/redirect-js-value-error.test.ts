import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A `${value}` redirect target that the command cannot use (an in-memory Blob
// or Response as stdout) is reported as a JS error. When that command is not
// the first thing the script runs, the error is raised from an event-loop
// callback (the previous command's exit) instead of from the `.run()` host
// call. The ShellPromise must still reject with it, no exception may be left
// pending on the VM, and the process must be able to exit afterwards. Each
// case runs in its own process so that a hang or crash stays contained.
describe("a redirect to a JS value the command cannot use rejects the shell promise", () => {
  async function run(shell: string) {
    const script = /* js */ `
      import { $ } from "bun";
      const settle = p => p.then(r => "resolved " + r.exitCode, e => "rejected " + e.constructor.name + ": " + e.message);
      const bun = process.execPath;
      const out = [];
      out.push(await settle(${shell}));
      // The VM is still usable afterwards: nothing was left pending on it.
      out.push(await settle($\`echo ok\`.quiet()));
      console.log(JSON.stringify(out));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out: stdout.trim() === "" ? stderr : JSON.parse(stdout.trim()), exitCode };
  }

  const external = "rejected TypeError: Blobs are immutable, and cannot be used for stdout/stderr";
  const builtin = "rejected Error: Cannot redirect stdout/stderr to an immutable blob. Expected a file";

  test.concurrent("external command after another command", async () => {
    expect(await run("$`${bun} --version; ${bun} --version > ${new Response('r')}`.quiet().nothrow()")).toEqual({
      out: [external, "resolved 0"],
      exitCode: 0,
    });
  });

  test.concurrent("builtin after another command", async () => {
    expect(await run("$`${bun} --version; echo hi > ${new Blob(['x'])}`.quiet().nothrow()")).toEqual({
      out: [builtin, "resolved 0"],
      exitCode: 0,
    });
  });

  test.concurrent("inside && after another command", async () => {
    expect(await run("$`${bun} --version && echo hi > ${new Response('r')} && echo no`.quiet()")).toEqual({
      out: [builtin, "resolved 0"],
      exitCode: 0,
    });
  });

  // This already rejected (the error comes straight out of `.run()`), but the
  // interpreter was never finished, so it kept the event loop alive forever.
  test.concurrent("as the first command, and the process still exits", async () => {
    expect(await run("$`echo hi > ${new Response('r')}; echo no`.quiet().nothrow()")).toEqual({
      out: [builtin, "resolved 0"],
      exitCode: 0,
    });
  });
});
