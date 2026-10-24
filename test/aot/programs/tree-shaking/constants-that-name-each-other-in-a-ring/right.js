import { left } from "./left.js";
export const right = { go: n => (n === 0 ? "ended on the right" : left.go(n - 1)) };
export const unusedRight = { go: () => left };
