import { expect, test } from "bun:test";
import { bunExe, isASAN, isGlibc, isMacOS, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { withoutDebugInformation } from "../aot/harness/without-debug-information";
import { canTrim } from "./compile-trim-features";

// It writes what the system allocator holds to stderr: the number of blocks on macOS, the number of bytes with glibc.
const report = isMacOS
  ? `
  const { symbols: system } = dlopen("/usr/lib/libSystem.B.dylib", {
    malloc: { args: ["usize"], returns: "ptr" },
    free: { args: ["ptr"], returns: "void" },
    malloc_zone_statistics: { args: ["ptr", "ptr"], returns: "void" },
  });
  // malloc_statistics_t starts with \`unsigned blocks_in_use\`.
  const statistics = new Uint32Array(8);
  function report() {
    system.malloc_zone_statistics(null, statistics);
    console.error("Total:\\nin use blocks = " + statistics[0]);
  }`
  : `
  const { symbols: system } = dlopen("libc.so.6", {
    malloc: { args: ["usize"], returns: "ptr" },
    free: { args: ["ptr"], returns: "void" },
    malloc_stats: { args: [], returns: "void" },
  });
  const report = system.malloc_stats;`;
const smallestBlock = isMacOS ? 1 : 32;
const count = 2000;

// Bun.serve's router is C++ that allocates a few objects with `new` per route.
const program = `
  import { dlopen } from "bun:ffi";
  ${report}
  function serve(routeCount: number) {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < routeCount; i++) routes["/" + i] = () => new Response();
    return Bun.serve({ port: 0, routes });
  }

  // Whatever the first server loads or starts stays out of the measurement.
  await serve(1).stop(true);

  report();
  const blocks = Array.from({ length: ${count} }, () => system.malloc(64));
  report();
  for (const block of blocks) system.free(block);

  report();
  const server = serve(${count});
  report();
  await server.stop(true);
`;

for (const flags of [[], ["--trim"]]) {
  test.skipIf((!isMacOS && !isGlibc) || isASAN || (flags.includes("--trim") && !canTrim))(
    `${["--compile", ...flags].join(" ")}: objects that C++ allocates with new are not held by the system allocator`,
    async () => {
      using dir = tempDir("compile-trim-allocator", { "program.ts": program });
      const built = await run(
        [bunExe(), "build", "--compile", ...withoutDebugInformation, ...flags, "program.ts", "--outfile", "program"],
        String(dir),
      );
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
        stderr: expect.not.stringContaining("error:"),
        exitCode: 0,
      });
      const ran = await run([join(String(dir), "program")], String(dir));
      expect(ran.exitCode).toBe(0);
      const held = Array.from(
        ran.stderr.matchAll(/^Total.*\n(?:system .*\n)?in use \w+ += +(\d+)$/gm),
        ([, held]) => +held,
      );
      expect(held).toHaveLength(4);
      expect(held[1] - held[0]).toBeGreaterThanOrEqual(count * smallestBlock);
      expect(held[3] - held[2]).toBeLessThan(count * smallestBlock);
    },
  );
}
