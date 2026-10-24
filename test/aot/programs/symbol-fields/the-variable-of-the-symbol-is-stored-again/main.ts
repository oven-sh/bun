// The other module exports the symbol in a `let` and replaces it. What was stored under the first symbol is not found under the second.
import { kMass, replace } from "./keys.ts";

const holder: Record<symbol, number> = {};
function store(value: number): void {
  holder[kMass] = value;
}
function read(): number {
  return holder[kMass];
}
store(1);
const before = kMass;
console.log(read());
replace();
console.log(read(), before === kMass);
store(2);
console.log(read(), holder[before], Object.getOwnPropertySymbols(holder).length);
