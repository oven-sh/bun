// Where the objects of a program lie in memory is not the same from launch to launch, and nothing holds a large part of the first 4 GB of the address space for them.
// On Linux the memory map of the process says so. Elsewhere there is nothing to look at.
import { existsSync, readFileSync } from "node:fs";

interface Leaf { id: number; next: Leaf | null }
let head: Leaf | null = null;
for (let i = 0; i < 100000; i++) head = { id: i, next: head };
let total = 0;
for (let leaf = head; leaf; leaf = leaf.next) total += leaf.id;
console.log(total);

let reservedBelow4GB = 0;
if (existsSync("/proc/self/maps")) {
  for (const line of readFileSync("/proc/self/maps", "utf8").split("\n")) {
    const [range, , , , , name] = line.split(/\s+/);
    if (!range || name) continue;
    const [start, end] = range.split("-").map(text => parseInt(text, 16));
    if (start < 0x100000000) reservedBelow4GB += Math.min(end, 0x100000000) - start;
  }
}
console.log(reservedBelow4GB < 256 * 1024 * 1024 ? "less than 256 MB of unnamed mappings below 4 GB" : "unnamed mappings below 4 GB: " + Math.round(reservedBelow4GB / 1048576) + " MB");
