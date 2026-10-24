enum Way {
  Up = "UP",
  Down = "DOWN",
}

const holder: { way: Way } = { way: Way.Up };
const wide: { way: string } = holder;

function step(way: Way): number {
  if (way === Way.Up) return 1;
  if (way === Way.Down) return -1;
  const left: never = way;
  return String(left).length;
}
function isKnown(way: Way): boolean {
  return way === Way.Up || way === Way.Down;
}
function notUp(way: Way): string {
  return way !== Way.Up ? (way === Way.Down ? "down" : "neither") : "up";
}

console.log(step(holder.way), isKnown(holder.way), notUp(holder.way));
wide.way = "SIDEWAYS";
console.log(holder.way);
console.log(step(holder.way));
console.log(isKnown(holder.way));
console.log(notUp(holder.way));
wide.way = "DOWN";
console.log(step(holder.way), isKnown(holder.way), notUp(holder.way));
