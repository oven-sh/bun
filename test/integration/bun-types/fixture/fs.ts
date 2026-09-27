import { constants, readdir, watch } from "node:fs";

constants.O_APPEND;

import * as fs from "fs";
import * as barePromises from "fs/promises";
import { exists } from "fs/promises";
import * as nodeFs from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import * as tsd from "./utilities";

tsd.expectType<Promise<boolean>>(exists("/etc/passwd"));
tsd.expectType<Promise<boolean>>(fs.promises.exists("/etc/passwd"));
tsd.expectType<Promise<boolean>>(nodeFsPromises.exists("/etc/passwd"));
tsd.expectType<Promise<boolean>>(nodeFs.promises.exists("/etc/passwd"));
// The augmentation adds `exists` next to what the module already has.
nodeFsPromises.readFile satisfies typeof barePromises.readFile;

// file path
watch(".", (eventType, filename) => {
  console.log(`event type = ${eventType}`);
  if (filename) {
    console.log(`filename = ${filename}`);
  }
});

await Bun.file("sdf").exists();

readdir(".", { recursive: true }, (err, files) => {});
