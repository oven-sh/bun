// The class is named nowhere. Its static fields and its static block call its static methods, a static getter and its constructor through `this` while the class is being defined.
const log: string[] = [];

function double(n: number): number {
  return n * 2;
}

class Table {
  static get label(): string {
    return "table";
  }
  static size = this.compute(4);
  static instance = new this("made in a field");
  static {
    log.push("size " + this.size, this.instance.describe(), "label " + this.label);
  }
  static compute(n: number): number {
    return double(n) + 1;
  }
  constructor(public note: string) {}
  describe(): string {
    return "instance " + this.note;
  }
}

console.log(log.join("\n"));
