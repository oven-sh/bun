interface Point {
  x: number;
  y: number;
}

const origin: Point = { x: 1, y: 2 };

class Box {
  #point: Point | undefined;
  constructor(point?: Point) {
    this.#point = point;
  }
  get point(): Point {
    return this.#point as Point;
  }
  take(): Point {
    return this.#point!;
  }
}

function read(box: Box): number {
  return box.point.x + box.take().y;
}

function attempt(run: () => unknown) {
  try {
    postMessage("a box: " + run());
  } catch (error) {
    postMessage("an empty box: " + (error as Error).name);
  }
}

for (const box of [new Box(origin), new Box(), new Box(origin)]) attempt(() => read(box));
