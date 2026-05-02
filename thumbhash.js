import { file, write } from "bun";
console.time("Generate low quality placeholder image");
const thumbnail = await file(process.argv.at(-1)).image().placeholder();
console.log(`<img src=${thumbnail} />`);
console.timeEnd("Generate low quality placeholder image");
