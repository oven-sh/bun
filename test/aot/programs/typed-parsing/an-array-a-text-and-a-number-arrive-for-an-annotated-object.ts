interface Point {
  x: number;
  y: number;
}

function xOf(point: Point): number {
  return point.x;
}
function look(point: Point): string {
  return typeof point + " " + xOf(point) + " " + (xOf(point) === undefined) + " " + (point.x + point.y) + " " + JSON.stringify(point);
}

const fromList: Point = JSON.parse("[3,4]");
const fromText: Point = JSON.parse('"xy"');
const fromNumber: Point = JSON.parse("7");
const fromTruth: Point = JSON.parse("true");
const honest: Point = JSON.parse('{"x":3,"y":4}');
console.log(look(honest));
console.log(look(fromList), Array.isArray(fromList));
console.log(look(fromText));
console.log(look(fromNumber));
console.log(look(fromTruth));
const fromNull: Point = JSON.parse("null");
try {
  console.log(look(fromNull));
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(fromNull === null, typeof fromNull);
