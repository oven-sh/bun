import { expect, test } from "bun:test";
import { bunExe, isASAN, isMacOS, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";

// Bun.serve's router is C++ that allocates a few objects with `new` per route.
const program = `
  import { dlopen } from "bun:ffi";

  const { symbols: libSystem } = dlopen("/usr/lib/libSystem.B.dylib", {
    malloc: { args: ["usize"], returns: "ptr" },
    free: { args: ["ptr"], returns: "void" },
    malloc_zone_statistics: { args: ["ptr", "ptr"], returns: "void" },
  });
  // malloc_statistics_t starts with \`unsigned blocks_in_use\`.
  const statistics = new Uint32Array(8);
  function countSystemBlocks() {
    libSystem.malloc_zone_statistics(null, statistics);
    return statistics[0];
  }
  function serve(routeCount: number) {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < routeCount; i++) routes["/" + i] = () => new Response();
    return Bun.serve({ port: 0, routes });
  }

  // Whatever the first server loads or starts stays out of the measurement.
  await serve(1).stop(true);

  const count = 2000;
  let before = countSystemBlocks();
  const blocks = Array.from({ length: count }, () => libSystem.malloc(64));
  const afterMalloc = countSystemBlocks() - before;
  for (const block of blocks) libSystem.free(block);

  before = countSystemBlocks();
  const server = serve(count);
  const afterRoutes = countSystemBlocks() - before;
  await server.stop(true);

  console.log(JSON.stringify({ count, afterMalloc, afterRoutes }));
`;

test.skipIf(!isMacOS || isASAN).each([
  ["--compile", []],
  ["--compile --trim", ["--trim"]],
])("%s: objects that C++ allocates with new are not held by the system allocator", async (_, flags) => {
  using dir = tempDir("compile-trim-allocator", { "program.ts": program });
  const built = await run(
    [bunExe(), "build", "--compile", ...flags, "program.ts", "--outfile", "program"],
    String(dir),
  );
  if (built.stderr.includes("this build of Bun doesn't support --trim")) return;
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringContaining("error:"),
    exitCode: 0,
  });
  const ran = await run([join(String(dir), "program")], String(dir));
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { count, afterMalloc, afterRoutes } = JSON.parse(ran.stdout);
  expect(afterMalloc).toBeGreaterThanOrEqual(count);
  expect(afterRoutes).toBeLessThan(count);
});
