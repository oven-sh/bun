import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, tempDir } from "harness";

// Each scan()/scanSync() allocates a Box<GlobWalker> whose dominant owned
// allocation is a PathBuffer (4 KB on Linux, 1 KB on macOS, ~96 KB on
// Windows). When #29379 regresses, 10k iterations leak ~75-90 MB under a
// Linux ASAN build (quarantine disabled) and 30k leak ~40 MB on macOS
// release, versus a ~15 MB / ~7 MB noise floor with the fix in place.
// macOS keeps 30k even under debug/ASAN: at 1 KB per iteration a 10k run
// would only leak ~13-26 MB and slip under the 30 MB bound locally.
const iterations = (isASAN || isDebug) && !isMacOS ? 10_000 : 30_000;
const warmup = 500;
const thresholdMB = 30;

const cases = [
  { name: "scanSync", pattern: "**/*", files: { "a.txt": "", "b.txt": "", "sub/c.txt": "" }, sync: true },
  { name: "scan", pattern: "**/*", files: { "a.txt": "", "b.txt": "", "sub/c.txt": "" }, sync: false },
  { name: "scanSync does not leak GlobWalker struct", pattern: "*.txt", files: { "a.txt": "" }, sync: true },
  { name: "scan does not leak GlobWalker struct", pattern: "*.txt", files: { "a.txt": "" }, sync: false },
] as const;

describe("leaks", () => {
  for (const { name, pattern, files, sync } of cases) {
    test.concurrent(
      name,
      async () => {
        using dir = tempDir(`glob-leak-${name.replace(/\W+/g, "-")}`, files);
        const drain = sync ? "Array.from(glob.scanSync())" : "await Array.fromAsync(glob.scan())";
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "--smol",
            "-e",
            /* ts */ `
              const glob = new Bun.Glob(${JSON.stringify(pattern)});
              for (let i = 0; i < ${warmup}; i++) ${drain};
              Bun.gc(true);
              const before = process.memoryUsage.rss();
              for (let i = 0; i < ${iterations}; i++) ${drain};
              Bun.gc(true);
              console.log(((process.memoryUsage.rss() - before) / 1024 / 1024).toFixed(2));
            `,
          ],
          cwd: String(dir),
          env: {
            ...bunEnv,
            // ASAN parks freed allocations in a quarantine (~256 MB by default)
            // which swamps the RSS signal; disable it so one threshold holds for
            // every build. Harmless when the binary is not ASAN-instrumented.
            ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const growthMB = Number(stdout.trim());
        expect({ stderr, growthMB, exitCode }).toEqual({ stderr: "", growthMB: expect.any(Number), exitCode: 0 });
        expect(growthMB).toBeLessThan(thresholdMB);
      },
      60_000,
    );
  }
});
