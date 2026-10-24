function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function Tagged(Base: new () => Point) {
  return class extends Base {
    tag?: string = "tagged";
  };
}

const made = new (Tagged(Point))();
delete made.tag;
console.log("deleted: " + describe(made) + " " + made.tag);
made.tag = "again";
console.log("stored again: " + describe(made));
Object.assign(made, { added: 1 });
console.log("added: " + describe(made));
Object.freeze(made);
try {
  made.x = 100;
  console.log("stored to a frozen instance");
} catch (error) {
  console.log("a store to the frozen instance threw a TypeError: " + (error instanceof TypeError));
}
console.log("frozen: " + describe(made) + " " + made.sum());
