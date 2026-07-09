import { bunEnv, bunExe } from "harness";

// Regression: OHOS pipe write truncation on buffers >1MB.
// Before fix: write() returning 0 on a pipe-full was treated as EndOfFile,
// causing StaticPipeWriter to close the pipe prematurely and lose the
// remaining bytes. The child received uninitialized/garbage data in the
// unwritten region.
// Reproduces on OHOS HongMeng Kernel; threshold between 1MB and 2MB.

function childCounter() {
  return `
    const bytes = new Uint8Array(await Bun.stdin.arrayBuffer());
    let a = 0, other = 0;
    for (const byte of bytes) {
      if (byte === 0x41) a++;
      else other++;
    }
    console.log(JSON.stringify({ total: bytes.length, a, other }));
  `;
}

async function runSpawnSync(SIZE: number) {
  const input = new Uint8Array(SIZE).fill(0x41);
  const result = Bun.spawnSync({
    cmd: [bunExe(), "-e", childCounter()],
    env: bunEnv,
    stdin: input,
  });
  const out = new TextDecoder().decode(result.stdout).trim();
  return JSON.parse(out);
}

describe("spawnSync large stdin buffer", () => {
  // Sizes that previously failed on OHOS
  for (const sizeKB of [2048, 4096, 8192]) {
    const SIZE = sizeKB * 1024;
    test(`delivers all ${sizeKB}KB bytes without truncation`, async () => {
      const r = await runSpawnSync(SIZE);
      expect(r.total).toBe(SIZE);
      expect(r.a).toBe(SIZE);
      expect(r.other).toBe(0);
    }, 60_000);
  }
});

describe("Bun.spawn large stdin buffer", () => {
  for (const sizeKB of [2048, 4096]) {
    const SIZE = sizeKB * 1024;
    test(`async delivers all ${sizeKB}KB bytes without truncation`, async () => {
      const input = new Uint8Array(SIZE).fill(0x41);
      const child = Bun.spawn({
        cmd: [bunExe(), "-e", childCounter()],
        env: bunEnv,
        stdin: input,
        stdout: "pipe",
      });
      const out = await new Response(child.stdout).text();
      const r = JSON.parse(out.trim());
      expect(r.total).toBe(SIZE);
      expect(r.a).toBe(SIZE);
      expect(r.other).toBe(0);
    }, 60_000);
  }
});
