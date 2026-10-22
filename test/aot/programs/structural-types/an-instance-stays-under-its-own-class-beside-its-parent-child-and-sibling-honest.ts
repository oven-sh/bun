class Parent {
  id = 1;
  who(): string {
    return "parent " + this.id;
  }
  get rank(): number {
    return 1;
  }
}

class Self extends Parent {
  own = "self";
  who(): string {
    return "self " + this.id + " " + this.own;
  }
  get rank(): number {
    return 2;
  }
}

class Child extends Self {
  extra = "child";
  who(): string {
    return "child " + this.id + " " + this.extra;
  }
  get rank(): number {
    return 3;
  }
}

class Sibling extends Parent {
  other = "sibling";
  who(): string {
    return "sibling " + this.id + " " + this.other;
  }
  get rank(): number {
    return 4;
  }
}

function asParent(p: Parent): string {
  return p.who() + " " + p.rank;
}

function asSelf(s: Self): string {
  return s.who() + " " + s.rank;
}

const moved = new Self();
const honest = new Self();

function round(label: string): void {
  console.log(label + ": " + moved.who() + " " + moved.rank + " | " + asSelf(moved) + " | " + asParent(moved) + " | honest " + asSelf(honest) + " | " + asParent(honest) + " | " + [moved instanceof Parent, moved instanceof Self, moved instanceof Child, moved instanceof Sibling].join() + " | keys " + Object.keys(moved).join());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += asSelf(moved).length + asParent(moved).length + asSelf(honest).length + asParent(new Child()).length + asParent(new Sibling()).length + asParent(new Parent()).length;
console.log("2000 honest: " + warm);
round("its own class");
round("again 1");
round("again 2");
round("again 3");
round("again 4");
console.log("the others: " + [new Parent(), new Self(), new Child(), new Sibling()].map(asParent).join(" | "));

export {};
