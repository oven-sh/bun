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

function Tagged<B extends new (...args: any[]) => object>(Base: B) {
  return class extends Base {
    tag = "tagged";
    shout(): string {
      return this.tag.toUpperCase();
    }
  };
}

const TaggedPoint = Tagged(Point);
type TaggedPoint = InstanceType<typeof TaggedPoint>;

function total(p: TaggedPoint): number {
  return p.x + p.y + p.tag.length;
}

function move(p: TaggedPoint): void {
  p.x += 10;
  p.tag += "!";
}

const made = new TaggedPoint();
console.log(describe(made));
console.log("read: " + made.x + " " + made.y + " " + made.tag + " " + made.sum() + " " + made.shout() + " " + total(made));
move(made);
console.log("after stores: " + describe(made) + " " + total(made) + " " + made.sum());
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(new TaggedPoint());
console.log("2000 rounds: " + warm);
