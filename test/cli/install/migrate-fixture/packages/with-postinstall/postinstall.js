import { accessSync, writeFileSync } from "fs";

writeFileSync(import.meta.dir + "/postinstall.txt", `i ran!`);

import "sharp";
