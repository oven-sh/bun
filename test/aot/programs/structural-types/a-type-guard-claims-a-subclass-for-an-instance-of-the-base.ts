class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

function isSquare(s: Shape): s is Square {
  return true;
}

const s = new Shape();
console.log(isSquare(s) ? s.edge * 2 : -1);
