import fs from "fs";
import { fileURLToPath } from "url";
console.log(fs.existsSync(fileURLToPath(import.meta.url)), fs.existsSync(import.meta.path));
