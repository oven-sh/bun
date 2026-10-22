// A module is found in the image by its bytes, however the program reads the imported file and whichever call makes the module.
/// <reference path="../wasm-files.d.ts" />
import { readFileSync } from "node:fs";
import path from "./adds.wasm";

type Add = (a: number, b: number) => number;
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
console.log((new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports.add as Add)(19, 23));
console.log((new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(readFileSync(path))), {}).exports.add as Add)(20, 23));
console.log(((await WebAssembly.instantiate(bytes, {})).instance.exports.add as Add)(21, 23));
console.log((new WebAssembly.Instance(await WebAssembly.compile(bytes.buffer), {}).exports.add as Add)(22, 23));
