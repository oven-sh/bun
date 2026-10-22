class Base {
  x = 1;
}

function next(b: Base): number {
  return b.x + 1;
}

console.log(next(new Base()));
