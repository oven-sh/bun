// Spawned detached by `removeAtExit()` in harness.ts. Stdin is a pipe whose only
// write end is held by the test process, so EOF means that process is gone.
import { readFileSync, rmSync } from "node:fs";

const manifest = process.argv[2];
await Bun.stdin.text();
for (const path of readFileSync(manifest, "utf8").split("\n")) {
  if (path) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {}
  }
}
rmSync(manifest, { force: true });
