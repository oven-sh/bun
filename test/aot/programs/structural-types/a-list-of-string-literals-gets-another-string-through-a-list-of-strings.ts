type Mode = "fast" | "slow";

const modes: Mode[] = ["fast", "slow"];
const wide: string[] = modes;

function speed(mode: Mode): number {
  return mode === "fast" ? 2 : mode === "slow" ? 1 : String(mode satisfies never).length;
}
function total(list: Mode[]): number {
  let sum = 0;
  for (const mode of list) sum += speed(mode);
  return sum;
}
function count(list: Mode[], wanted: Mode): number {
  let found = 0;
  for (const mode of list) if (mode === wanted) found++;
  return found;
}

console.log(total(modes), count(modes, "fast"), modes.indexOf("slow"));
wide.push("medium", ["fa", "st"].join(""), "");
console.log(modes.join());
console.log(total(modes));
console.log(count(modes, "fast"), count(modes, "slow"));
console.log(modes.indexOf("fast"), modes.lastIndexOf("fast"), modes.includes("slow"));
console.log(modes.filter(mode => mode === "fast" || mode === "slow").length);
console.log(modes.filter(mode => mode !== "fast" && mode !== "slow").join("|"));
console.log(modes.map(speed).join());
