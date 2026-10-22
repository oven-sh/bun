const log: string[] = [];

class Report {
  rows: number[];
  constructor(...rows: number[]) {
    this.rows = rows;
  }
  get total(): number {
    log.push("computed");
    let sum = 0;
    for (const row of this.rows) sum += row;
    Object.defineProperty(this, "total", { value: sum, configurable: true });
    return sum;
  }
  get shared(): string {
    log.push("shared computed");
    Object.defineProperty(Report.prototype, "shared", { value: "shared by " + this.rows.length, configurable: true });
    return "first read";
  }
  summary(): string {
    return this.total + " of " + this.rows.length;
  }
}

function totalOf(r: Report): number {
  return r.total;
}

function twice(r: Report): number {
  return r.total + r.total;
}

function line(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

const a = new Report(1, 2, 3);
line("the first read", totalOf(a));
line("the second read", totalOf(a));
line("own now", Object.hasOwn(a, "total") + " keys " + Object.keys(a).join());
a.rows.push(100);
line("the rows changed, the value stays", totalOf(a) + " " + a.summary());
Reflect.deleteProperty(a, "total");
line("forgotten", totalOf(a) + " " + a.summary());

line("two reads in one expression", twice(new Report(5)));
line("through a method", new Report(7).summary());

const many: Report[] = [];
for (let i = 0; i < 2000; i++) many.push(new Report(i, 1));
let sum = 0;
for (const r of many) sum += totalOf(r) + totalOf(r);
line("2000 reports, two reads each, computed " + log.length + " times", sum);

line("the shared getter, first", a.shared);
line("second", a.shared);
line("another instance", new Report().shared);

export {};
