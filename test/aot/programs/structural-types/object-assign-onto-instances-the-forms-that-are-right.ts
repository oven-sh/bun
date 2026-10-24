class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

class AlsoStoredPlainly {
  leaf: Leaf | null = new Leaf();
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Holder {
  shape: Shape = new Square();
}

type Plain = { leaf: { weight: number } | null };

const returned: Cell = Object.assign(new Cell(), { leaf: null });
console.log("the result of Object.assign:", returned.leaf === null ? -1 : returned.leaf.weight);

const other = new AlsoStoredPlainly();
other.leaf = null;
const stored = new AlsoStoredPlainly();
Object.assign(stored, { leaf: null });
console.log("null is also stored plainly:", stored.leaf === null ? -1 : stored.leaf.weight);

const literal: Plain = { leaf: { weight: 7 } };
Object.assign(literal, { leaf: null });
console.log("the target is a literal:", literal.leaf === null ? -1 : literal.leaf.weight);

const holder = new Holder();
Object.assign(holder, { shape: new Shape() });
console.log("another class:", holder.shape instanceof Square ? holder.shape.edge : "no square");

const spread: Cell = { ...new Cell(), ...{ leaf: null } };
console.log("a spread:", spread.leaf === null ? -1 : spread.leaf.weight);
