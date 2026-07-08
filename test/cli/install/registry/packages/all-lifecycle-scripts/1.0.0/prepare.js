import { writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const file = join(import.meta.dir, "prepare.txt");

if (existsSync(file)) {
  rmSync(file);
  writeFileSync(file, "prepare exists!");
} else {
  writeFileSync(file, "prepare!");
}
