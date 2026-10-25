import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow } from "harness";

describe("spawn with empty", () => {
  for (const [stdin, label] of [
    [new ArrayBuffer(0), "ArrayBuffer"],
    [new Uint8Array(0), "Uint8Array"],
    [new Blob([]), "Blob"],
  ] as const) {
    test(label + " for stdin", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin: stdin as Uint8Array | Blob,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [exited, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
      expect(exited).toBe(0);
      expect(stdout).toBeEmpty();
      expect(stderr).toBeEmpty();
    });
  }
});

// A Blob is refused for stdout, stderr and the extra stdio slots. A Response or a
// Request with an all-ASCII string body reaches that refusal as a reference on
// the string, so the refusal has to release it.
describe("spawn releases the string body of a Response or Request that it refuses", () => {
  const cases: [name: string, call: string][] = [
    ["Bun.spawn stdout", `Bun.spawn(cmd, { stdout: new Response(body) })`],
    ["Bun.spawn stderr", `Bun.spawn(cmd, { stderr: new Response(body) })`],
    ["Bun.spawn stdio[3]", `Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore", new Response(body)] })`],
    ["Bun.spawnSync stdout", `Bun.spawnSync(cmd, { stdout: new Response(body) })`],
    [
      "Bun.spawn stdout, a Request",
      `Bun.spawn(cmd, { stdout: new Request("http://127.0.0.1:1/", { method: "POST", body }) })`,
    ],
    // The shell starts an external command through the same stdio setup.
    ["Bun.$ > redirect", "Bun.$`${cmd} > ${new Response(body)}`.quiet()"],
    ["Bun.$ 2> redirect", "Bun.$`${cmd} 2> ${new Response(body)}`.quiet()"],
  ];

  // One child at a time: a debug build is too slow to run all of them at once.
  test.each(cases)("%s", async (_name, call) => {
    const code = /* js */ `
      const cmd = [process.execPath, "--version"];
      const pad = Buffer.alloc(4 * 1024 * 1024, "a").toString();
      let seq = 0;
      async function run(calls) {
        for (let i = 0; i < calls; i++) {
          // A fresh string for each call: one reused string is one allocation.
          const body = ++seq + pad;
          try { await ${call}; } catch {}
        }
        Bun.gc(true);
        return process.memoryUsage.rss();
      }
      const before = await run(8);
      const after = await run(48);
      console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
    `;
    // Unfixed: 192 MiB, the 48 bodies of 4 MiB. Fixed: under 4 MiB on a release
    // build and 8 to 21 MiB on a debug build, where a loop that only flattens
    // the string measures the same.
    await expectRssDeltaBelow(["--smol", "-e", code], { release: 48, debug: 96 });
  });
});
