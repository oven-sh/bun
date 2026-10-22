interface Named {
  name: string;
}

class Short implements Named {
  name = "short";
}

class Long implements Named {
  extra = 1;
  more = "more";
  name = "long";
}

class Tool {
  total = 0;
  count(n: number): string {
    this.total += n;
    return "count " + (n + 1) + " " + (n | 0) + " " + n * 2 + " " + this.total;
  }
  measure(n: number): string {
    return "measure " + n;
  }
  index(list: string[], i: number): string {
    return "index " + list[i];
  }
  pick(list: string[], i: number): string {
    return "pick " + i + " of " + list.length;
  }
  first(list: number[]): string {
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum += list[i];
    return "first " + list[0] + " sum " + sum;
  }
  all(list: number[]): string {
    return "all " + list.length;
  }
  greet(who: Named): string {
    return "greet " + who.name + " " + who.name.length;
  }
  meet(who: Named): string {
    return "meet " + typeof who;
  }
  mode(kind: "fast" | "slow"): string {
    return kind === "fast" ? "mode fast" : "mode not fast: " + kind;
  }
  speed(kind: "fast" | "slow"): string {
    return "speed " + kind.length;
  }
  pad(text: string, width: number = 3): string {
    return "pad " + text.padStart(width, ".") + " " + width;
  }
  trim(text: string, width?: number): string {
    return "trim " + text + " " + width;
  }
}

const words = ["zero", "one", "two"];
const tool = new Tool();

function honest(t: Tool, i: number): string {
  return [t.count(i % 3), t.index(words, i % 3), t.first([1, 2, 3]), t.greet(new Short()), t.mode("fast"), t.pad("x", 2)].join(" | ");
}

function wide(t: Tool): string[] {
  return [
    t.measure(0.5),
    t.measure(-0),
    t.measure(NaN),
    t.measure(2 ** 31),
    t.measure(-(2 ** 31) - 1),
    t.pick(words, 1.5),
    t.pick(words, -1),
    t.pick(words, 99),
    t.pick(words, NaN),
    t.all([0.5, 1.5]),
    t.all([]),
    t.all(new Array<number>(2)),
    t.all([2 ** 40, -0]),
    t.meet(new Long()),
    t.meet({ name: "literal" }),
    t.meet({
      get name() {
        return "from a getter";
      },
    }),
    t.speed("slow"),
    t.trim("y"),
    t.trim("y", undefined),
    t.trim("y", 2.5),
  ];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += honest(tool, i).length;
tool.total = 0;
console.log("2000 honest: " + warm);
console.log("honest: " + honest(tool, 1));
for (const line of wide(tool)) console.log("as written: " + line);

tool.total = 0;
for (const line of wide(tool)) console.log("a second time: " + line);
console.log("the total: " + tool.total + " " + Object.is(tool.total, NaN));
tool.total = 0;
console.log("honest again: " + honest(tool, 1));

export {};
