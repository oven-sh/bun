import { constants, readdir, watch } from "node:fs";

constants.O_APPEND;

import * as fs from "fs";
import { exists } from "fs/promises";
import * as tsd from "./utilities";

tsd.expectType<Promise<boolean>>(exists("/etc/passwd"));
tsd.expectType<Promise<boolean>>(fs.promises.exists("/etc/passwd"));

// file path
watch(".", (eventType, filename) => {
  console.log(`event type = ${eventType}`);
  if (filename) {
    console.log(`filename = ${filename}`);
  }
});

await Bun.file("sdf").exists();

readdir(".", { recursive: true }, (err, files) => {});
