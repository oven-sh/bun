import fs from "fs";
fs.watch(import.meta.path, { signal: AbortSignal.timeout(4000) })
  .on("error", err => {
    console.error(err.message);
    process.exit(1);
  })
  .close();
