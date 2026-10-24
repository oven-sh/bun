interface Point {
  x: number;
  y: number;
}

function copy(p: Point): Point {
  return { ...p };
}

const wide = { x: 1, y: 2, z: 3 };
console.log(JSON.stringify(copy(wide)));
console.log(Object.keys(copy(wide)).join());
console.log("z" in copy(wide));
console.log(JSON.stringify(copy({ x: 4, y: 5 })));

export {};
