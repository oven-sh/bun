import { readdir } from "fs/promises";

const files = await readdir(`/tmp`, {});
console.log(files.map(a => a));
