import "reflect-metadata";

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

class Line {
  private _start: Point;
  private _end: Point;

  @validate
  set start(value: Point) {
    this._start = value;
  }

  get start() {
    return this._start;
  }

  @validate
  set end(value: Point) {
    this._end = value;
  }

  get end() {
    return this._end;
  }
}

function validate<T>(target: any, propertyKey: string, descriptor: TypedPropertyDescriptor<T>) {
  let set = descriptor.set!;

  descriptor.set = function (value: T) {
    let type = Reflect.getMetadata("design:type", target, propertyKey);

    if (!(value instanceof type)) {
      throw new TypeError(`Invalid type, got ${typeof value} not ${type.name}.`);
    }

    set.call(this, value);
  };
}

const line = new Line();
line.start = new Point(0, 0);

test("ts_example", () => {
  expect(Reflect.getMetadata("design:type", line, "start")).toBe(Point);
  expect(Reflect.getMetadata("design:type", line, "end")).toBe(Point);
  expect(Reflect.getMetadata("design:paramtypes", line, "start")).toStrictEqual([Point]);
  expect(Reflect.getMetadata("design:paramtypes", line, "end")).toStrictEqual([Point]);
  expect(Reflect.getMetadata("design:returntype", line, "start")).toBe(undefined);
  expect(Reflect.getMetadata("design:returntype", line, "end")).toBe(undefined);
});

// this causes a typescript error; you're not
class HasBothGetterAndSetter {
  _start?: Point;

  @validate
  get start(): Point {
    return this._start;
  }

  @validate
  set start(value: Point) {
    this._start = value;
  }
}

test("not allowed by typescript", () => {
  const l2 = new HasBothGetterAndSetter();
  expect(Reflect.getMetadata("design:type", l2, "start")).toBe(Point);
  expect(Reflect.getMetadata("design:paramtypes", l2, "start")).toStrictEqual([Point]);
  expect(Reflect.getMetadata("design:returntype", l2, "start")).toBe(undefined);
});
