import { readdir } from "fs/promises";
import { tmpdir } from "os";

const files = await readdir(tmpdir(), {});
console.log(files.map(a => a));
