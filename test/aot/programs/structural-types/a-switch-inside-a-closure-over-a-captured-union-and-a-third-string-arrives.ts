type Side = "left" | "right";
function ask(run: () => number): number {
  return run();
}
function turn(side: Side): number {
  return ask(() => {
    switch (side) {
      case "left":
        return -1;
      case "right":
        return 1;
      default:
        return 0;
    }
  });
}
const sides: Side[] = ["left"];
const wide: unknown[] = sides;
wide.push("up");
console.log(turn(sides[0]));
console.log(turn(sides[1]));
export {};
