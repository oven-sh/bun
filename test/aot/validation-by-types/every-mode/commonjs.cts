interface Point {
  x: number;
  y: number;
}
function parsePoint(text: string): string {
  try {
    return JSON.stringify(JSON.parse<Point>(text));
  } catch (error: any) {
    return error.constructor.name + " " + error.message;
  }
}
module.exports = { parsePoint };
