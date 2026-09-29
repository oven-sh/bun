// Run under redirect-open. Each argument is a directory that holds proc/ and sys/
// files. Prints what os.cpus() gives with that directory as the current directory.
const os = require("node:os");
const { basename } = require("node:path");

const out = {};
for (const dir of process.argv.slice(2)) {
  process.chdir(dir);
  try {
    const cpus = os.cpus();
    // The first read of a field fills the array.
    void cpus[0]?.model;
    out[basename(dir)] = JSON.parse(JSON.stringify(cpus));
  } catch (e) {
    out[basename(dir)] = { error: e.code ?? e.name, message: e.message };
  }
}
console.log(JSON.stringify(out));
