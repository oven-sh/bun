function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  corner = 90;
}

class Holder {
  shape: Shape = new Square();
}

function swap(h: Holder): void {
  h.shape = new Shape();
}

const holder = new Holder();
if (holder.shape instanceof Square) {
  say("before: edge", holder.shape.edge);
  swap(holder);
  say("after: edge", holder.shape.edge);
  say("after: corner", holder.shape.corner);
  say("after: edge doubled", holder.shape.edge * 2);
  say("after: sides", holder.shape.sides);
  const kept: Square = holder.shape;
  say("kept: edge", kept.edge);
  say("kept: keys", Object.keys(kept).join());
}
