import { writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const file = join(import.meta.dir, "postprepare.txt");

if (existsSync(file)) {
  rmSync(file);
  writeFileSync(file, "postprepare exists!");
} else {
  writeFileSync(file, "postprepare!");
}
