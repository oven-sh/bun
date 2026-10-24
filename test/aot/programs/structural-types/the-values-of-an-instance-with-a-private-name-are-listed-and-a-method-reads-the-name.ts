function see(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "threw";
  }
}
class Point {
  #x = 40.75;
  read(): number {
    return this.#x;
  }
}
function probe(point: Point): string {
  return see(() => Object.values(point).length) + " " + see(() => point.read());
}
console.log("values and the private name: " + probe(new Point()));
