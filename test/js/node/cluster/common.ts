import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function tmpdirSync(pattern: string = "bun.test.") {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), pattern));
}
