import { writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

const file = join(import.meta.dir, "postinstall.txt");

if (existsSync(file)) {
  rmSync(file);
  writeFileSync(file, "postinstall exists!");
} else {
  writeFileSync(file, "postinstall!");
}
