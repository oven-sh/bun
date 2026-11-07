import { fromByteArray, toByteArray } from "base64-js";
import { run } from "../turns";

const bytes = new Uint8Array(48 * 1024);
for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 131 + (index >> 8)) & 255;
const text = fromByteArray(bytes);

await run(process.argv[2] === "decode" ? () => toByteArray(text) : () => fromByteArray(bytes));
