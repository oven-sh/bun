import type { int32 } from "bun";
enum Color {
  Red,
  Green,
}
function fromHolder(holder: { color: Color }): int32 {
  return holder.color;
}
console.log("zzqq");
