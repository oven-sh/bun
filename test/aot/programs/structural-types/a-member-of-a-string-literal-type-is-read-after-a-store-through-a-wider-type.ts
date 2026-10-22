const holder: { mode: "fast" } = { mode: "fast" };
const wide: { mode: string } = holder;

function modeOf(): "fast" {
  return holder.mode;
}

console.log(holder.mode, holder.mode === "fast", modeOf().length);
wide.mode = "slower";
console.log(holder.mode);
console.log(holder.mode === "fast");
console.log(holder.mode.length);
console.log(modeOf());
console.log(modeOf() === "fast" ? "still fast" : "changed");
