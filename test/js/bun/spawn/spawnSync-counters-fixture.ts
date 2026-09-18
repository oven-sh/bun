import { spawnSync } from "bun";
import { getCounters } from "bun:internal-for-testing";

// Counter deltas of one spawnSync call. `spawnSync_blocking` counts the fast
// path that blocks in waitpid instead of running the isolated event loop.
// `spawn_memfd` counts stdio slots served from a memfd instead of a pipe.
function counted(run: () => { exitCode: number }) {
  const before = getCounters();
  const { exitCode } = run();
  const after = getCounters();
  return {
    exitCode,
    spawnSync_blocking: after.spawnSync_blocking - before.spawnSync_blocking,
    spawn_memfd: after.spawn_memfd - before.spawn_memfd,
  };
}

console.log(
  JSON.stringify({
    inherit: counted(() => spawnSync({ cmd: ["true"], stdin: "inherit", stdout: "inherit", stderr: "inherit" })),
    bufferStdin: counted(() =>
      spawnSync({ cmd: ["true"], stdin: new Uint8Array([104, 105]), stdout: "inherit", stderr: "inherit" }),
    ),
  }),
);
