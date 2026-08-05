// ESM half of the corpus for bundler_bytecode_portable.test.ts: module code, top-level await, import.meta.
export const answer = await Promise.resolve(42);
export default function describe() {
  return `answer=${answer}`;
}
export class Holder {
  static value = answer;
  #tag = "h";
  toString() {
    return this.#tag + Holder.value;
  }
}
console.log("esm", describe(), String(new Holder()), typeof import.meta.url);
