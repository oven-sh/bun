// Run under redirect-open. Each argument is a directory that holds proc/ and sys/
// files. Prints what os.cpus() gives with that directory as the current directory.
import os from "node:os";
import { basename } from "node:path";

const out: Record<string, unknown> = {};
for (const dir of process.argv.slice(2)) {
  process.chdir(dir);
  try {
    const cpus = os.cpus();
    // The array is lazy and has the CPU count of the host until the first read of a field.
    void cpus[0]?.model;
    out[basename(dir)] = JSON.parse(JSON.stringify(cpus));
  } catch (e: any) {
    out[basename(dir)] = { error: e.code ?? e.name, message: e.message };
  }
}
console.log(JSON.stringify(out));
