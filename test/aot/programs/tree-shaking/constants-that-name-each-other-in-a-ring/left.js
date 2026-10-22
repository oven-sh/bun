import { right } from "./right.js";
export const left = { go: n => (n === 0 ? "ended on the left" : right.go(n - 1)) };
export const unusedLeft = { go: () => right };
