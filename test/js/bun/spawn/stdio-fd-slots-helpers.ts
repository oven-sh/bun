import { spawn } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = join(import.meta.dir, "fixtures", "stdio-fd-slots-fixture.js");

export type SpawnStdioOptions = { stdio?: unknown[]; stdin?: unknown; stdout?: unknown; stderr?: unknown };

/**
 * Starts a bun process whose fds 0, 1 and 2 are three different files. In it, `api` runs one spawn
 * per entry of `rows`, with the entry as the spawn options. `"Bun.file(0)"`, `"process.stdin"` and
 * the like in an entry stand for those values.
 *
 * Returns, for each row in order, `reaches` and then what `api` returned in that process.
 * `reaches[n]` is the fd of that process that the child's fd `n` is, or null when it is none of
 * 0, 1 and 2. `stillOpen` tells whether that process had its fds 0, 1 and 2 after the last spawn.
 */
export async function spawnWithStdioFiles(api: string, rows: SpawnStdioOptions[]) {
  using dir = tempDir("stdio-fd-slots", { fd0: "", fd1: "", fd2: "" });
  const files = ["fd0", "fd1", "fd2"].map(name => join(String(dir), name));
  const resultFile = join(String(dir), "result.json");
  const fds: number[] = [];
  let exitCode: number;
  try {
    for (const file of files) fds.push(openSync(file, "r+"));
    await using proc = spawn({
      cmd: [bunExe(), fixture, resultFile, api, JSON.stringify(rows)],
      env: bunEnv,
      stdio: [fds[0], fds[1], fds[2]],
    });
    exitCode = await proc.exited;
  } finally {
    for (const fd of fds) closeSync(fd);
  }
  const written = files.map(file => readFileSync(file, "utf8"));
  // An uncaught error of the fixture is in the file that was its stderr.
  if (exitCode !== 0) throw new Error(`stdio-fd-slots-fixture.js exited with code ${exitCode}:\n${written[2]}`);
  const { results, stillOpen } = JSON.parse(readFileSync(resultFile, "utf8"));
  return {
    rows: results.map((result: object, row: number) => ({
      reaches: Array.from({ length: rows[row].stdio?.length ?? 3 }, (_, fd) => {
        const file = written.findIndex(text => text.includes(`row${row}fd${fd};`));
        return file === -1 ? null : file;
      }),
      ...result,
    })),
    stillOpen,
  };
}
