const log: string[] = [];

class Plain {
  width = 2;
  height = 3;
  area(): number {
    return this.width * this.height;
  }
}

class Watched {
  private w = 20;
  private h = 30;
  get width(): number {
    log.push("get width");
    return this.w;
  }
  set width(value: number) {
    log.push("set width " + value);
    this.w = value;
  }
  get height(): number {
    log.push("get height");
    return this.h;
  }
  set height(value: number) {
    log.push("set height " + value);
    this.h = value;
  }
  area(): number {
    log.push("area");
    return this.width * this.height;
  }
}

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

function width(p: Plain): number {
  return p.width;
}

function perimeter(p: Plain): number {
  return 2 * (p.width + p.height);
}

function widen(p: Plain, by: number): number {
  p.width += by;
  return p.width;
}

function grow(p: Plain): void {
  p.height++;
  p.width = p.height;
}

class Frame {
  constructor(public inner: Plain) {}
  measure(): number {
    return this.inner.width + this.inner.height;
  }
}

const watched: Plain = new Watched();
flush("local read", watched.width);
flush("parameter read", width(watched));
flush("two reads in order", perimeter(watched));
flush("compound store", widen(watched, 1));
flush("increment then store", grow(watched));
flush("method", watched.area());
flush("field", new Frame(watched).measure());
flush("keys", Object.keys(watched).join());
flush("json", JSON.stringify(watched));
flush("spread", JSON.stringify({ ...watched }));
flush("own width", Object.hasOwn(watched, "width"));
flush("width in it", "width" in watched);
flush("instanceof", watched instanceof Plain);
flush("destructured", (({ height, width }: Plain) => height - width)(watched));
flush("the class's method borrowed", Plain.prototype.area.call(watched));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += perimeter(new Plain()) + widen(new Plain(), 1);
flush("2000 honest", sum);
flush("then the watched one, read", perimeter(new Watched()));
flush("then the watched one, store", widen(new Watched(), 5));
flush("then honest", perimeter(new Plain()));

const list: Plain[] = [new Plain(), new Watched(), new Plain()];
flush("elements", list.map(p => p.width).join());
for (const p of list) p.height = 1;
flush("stores through elements", list.map(p => p.area()).join());

const captured = () => watched.height;
flush("captured", captured());

export {};
