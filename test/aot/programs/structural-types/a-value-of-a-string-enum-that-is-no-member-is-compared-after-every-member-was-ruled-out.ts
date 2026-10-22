enum Way {
  Up = "UP",
  Down = "DOWN",
}
const ways: Way[] = [Way.Up, Way.Down];

function text(way: Way): string {
  if (way === Way.Up) return "up";
  if (way === Way.Down) return "down";
  return "neither, undefined: " + (way === undefined) + ", a string: " + (typeof way === "string");
}
function other(way: Way): string {
  if (way === Way.Up) return "up";
  return "down: " + (way === Way.Down);
}

console.log(text(ways[0]), text(ways[1]));
console.log(other(ways[2]));
console.log(text(ways[2]));
const texts: string[] = ways;
texts.push("SIDE");
console.log(other(ways[2]));
console.log(text(ways[2]));
