// A module that the program reads from a file, and names by a text, is compiled when the program is built.
declare const readFile: undefined | ((path: string, mode: "binary") => Uint8Array<ArrayBuffer>);
const bytes = typeof readFile === "function" ? readFile("adds.wasm", "binary") : new Uint8Array(await Bun.file("adds.wasm").arrayBuffer());
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
console.log((instance.exports.add as (a: number, b: number) => number)(19, 23));
