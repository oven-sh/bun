// Run under redirect-open. Each argument is a directory that holds proc/ and sys/
// files. Prints what os.cpus() gives with that directory as the current directory.
// With --one-free-fd, os.cpus() runs while all file descriptors but one are in use.
import { closeSync, openSync } from "node:fs";
import os from "node:os";
import { basename } from "node:path";

const oneFreeFd = process.argv[2] === "--one-free-fd";
const out: Record<string, unknown> = {};
for (const dir of process.argv.slice(oneFreeFd ? 3 : 2)) {
  process.chdir(dir);
  const held: number[] = [];
  try {
    if (oneFreeFd) {
      try {
        for (;;) held.push(openSync("/dev/null", "r"));
      } catch {}
      closeSync(held.pop()!);
    }
    const cpus = os.cpus();
    // The array is lazy and has the CPU count of the host until the first read of a field.
    void cpus[0]?.model;
    out[basename(dir)] = JSON.parse(JSON.stringify(cpus));
  } catch (e: any) {
    out[basename(dir)] = { error: e.code ?? e.name, message: e.message };
  } finally {
    for (const fd of held) closeSync(fd);
  }
}
console.log(JSON.stringify(out));
