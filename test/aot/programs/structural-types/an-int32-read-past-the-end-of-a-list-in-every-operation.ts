import type { int32 } from "bun";

const list: int32[] = [1, 2];
const odd: int32 = list[2];
console.log(odd);
console.log(typeof odd, typeof odd === "number", odd === undefined, odd === 0, odd === odd);
console.log(odd + 1, odd * 2, odd | 0, odd >>> 0, -odd, ~odd, odd << 1, odd % 2, odd / 2);
console.log(odd < 1, odd > 1, odd <= 0, odd >= 0, odd == 0, odd != 0, odd == null);
console.log(String(odd), `${odd}`, JSON.stringify(odd), JSON.stringify([odd]), Number(odd), Number.isInteger(odd), Math.abs(odd), Math.max(odd, 1));
console.log(odd ? 1 : 0, !odd, odd ?? 3, odd || 4, odd && 5);
class Cell {
  held: int32 = 0;
  next: int32 = 7;
}
const cell = new Cell();
cell.held = odd;
console.log(cell.held, cell.next, cell.held === undefined, cell.held + 1, JSON.stringify(cell), Object.keys(cell).join());
const ints = new Int32Array(2);
const past: int32 = ints[2];
console.log(past, typeof past, past === undefined, past + 1, past | 0, past === 0);
cell.held = past;
console.log(cell.held, cell.next, JSON.stringify(cell));
