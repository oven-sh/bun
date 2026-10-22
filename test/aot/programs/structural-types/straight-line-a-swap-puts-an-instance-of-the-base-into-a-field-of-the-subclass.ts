class Shape {
  sides = 0;
}

class Square extends Shape {
  edge = 3;
  area(): number {
    return this.edge * this.edge;
  }
}

class Drawing {
  front = new Square();
  back = new Shape();
  size(): number {
    return this.front.edge * 2;
  }
}

function swap<T, K extends keyof T>(target: T, a: K, b: K): void {
  const kept = target[a];
  target[a] = target[b];
  target[b] = kept;
}

const drawing = new Drawing();
console.log(drawing.size());
swap(drawing, "front", "back");
console.log(drawing.front instanceof Square);
console.log(typeof drawing.front.edge);
console.log(drawing.front.edge * 2);
console.log(drawing.size());
console.log(drawing.back.sides);
console.log(JSON.stringify(drawing));
try {
  console.log(drawing.front.area());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
