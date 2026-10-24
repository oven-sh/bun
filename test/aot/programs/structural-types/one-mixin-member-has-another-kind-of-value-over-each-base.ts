function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class WithNumber {
  value: number | string | number[] = 7;
}

class WithText {
  value: number | string | number[] = "seven";
}

class WithList {
  value: number | string | number[] = [7, 7];
}

function Measured(Base: new () => { value: number | string | number[] }) {
  return class extends Base {
    size(): number {
      const v = this.value;
      return typeof v === "number" ? v : v.length;
    }
    kind(): string {
      return typeof this.value;
    }
    doubled(): string {
      const v = this.value;
      return typeof v === "number" ? String(v * 2) : typeof v === "string" ? v + v : v.concat(v).join("");
    }
  };
}

const kinds = [WithNumber, WithText, WithList];
for (let round = 0; round < 2; round++) {
  for (const Base of kinds) {
    const made = new (Measured(Base))();
    console.log(Base.name + ": " + made.size() + " " + made.kind() + " " + made.doubled() + " " + describe(made));
  }
}
const One = Measured(WithNumber);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += new One().size();
console.log("2000 rounds over numbers: " + warm);
const changed = new One();
changed.value = "now a text";
console.log("one instance changes its kind: " + changed.size() + " " + changed.kind() + " " + changed.doubled());
