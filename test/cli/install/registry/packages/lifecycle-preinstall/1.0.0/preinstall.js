import { writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const file = join(import.meta.dir, "preinstall.txt");

if (existsSync(file)) {
  rmSync(file);
  writeFileSync(file, "preinstall exists!");
} else {
  writeFileSync(file, "preinstall!");
}
