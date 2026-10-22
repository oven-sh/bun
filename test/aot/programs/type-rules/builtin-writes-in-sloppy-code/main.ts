// In sloppy mode JavaScript ignores an assignment that fails. An assignment that the lock of a built-in refuses is not one of those: it throws a TypeError, whatever value it would replace, no setter runs, and `Reflect.set` returns false. What the language itself refuses stays ignored. Array.prototype keeps its members and takes no index and no well-known symbol, but a new ordinary name and a symbol of the program are stored as in plain Bun.
import { writes } from "./sloppy.cjs";
for (const it of writes) {
  try { console.log(it.label + ": " + String(it.write())); } catch (e: any) { console.log(it.label + ": " + e.name); }
}
