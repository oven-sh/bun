// In sloppy mode JavaScript ignores an assignment that fails. An assignment that fails only because --aot makes built-in objects immutable still throws, whatever value it would replace and whatever kind of key it uses. Assignments that JavaScript itself rejects stay silent, and `Reflect.set` returns false.
import { writes } from "./sloppy.cjs";
for (const it of writes) {
  try { console.log(it.label + ": " + String(it.write())); } catch (e: any) { console.log(it.label + ": " + e.name); }
}
