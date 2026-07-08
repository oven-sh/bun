import { writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const file = join(import.meta.dir, "preprepare.txt");

if (existsSync(file)) {
  rmSync(file);
  writeFileSync(file, "preprepare exists!");
} else {
  writeFileSync(file, "preprepare!");
}
