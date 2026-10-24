const holder: { on: true; off: false } = { on: true, off: false };
const wide: { on: boolean; off: boolean } = holder;

function isOn(): true {
  return holder.on;
}

console.log(holder.on, holder.off, isOn() ? "on" : "off");
wide.on = false;
wide.off = true;
console.log(holder.on);
console.log(holder.on ? "on" : "off");
console.log(!holder.on);
console.log(holder.on === true);
console.log(holder.off ? "off is true" : "off is false");
console.log(isOn() ? "on" : "off");
console.log(holder.on && holder.off);
console.log(holder.on || "neither");
