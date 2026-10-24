class Rule {
  readonly test: (n: number) => boolean = n => n > 0;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  apply(values: number[]): string {
    return values.map(v => (this.test(v) ? "y" : "n")).join("");
  }
}

interface MutableRule {
  test: (n: number) => boolean;
}

const table: { readonly double: (n: number) => number; readonly label: string } = { double: n => n * 2, label: "table" };
const frozenLooking: Readonly<{ triple: (n: number) => number }> = { triple: n => n * 3 };

function testOf(r: Rule, n: number): boolean {
  return r.test(n);
}

function doubleOf(t: { readonly double: (n: number) => number }, n: number): number {
  return t.double(n);
}

const values = [-1, 0, 1, 2];
const rule = new Rule("rule");
const other = new Rule("other");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += rule.apply(values).length + (testOf(rule, i) ? 1 : 0) + doubleOf(table, i) + frozenLooking.triple(i);
console.log("2000 honest: " + warm);
console.log("before: " + rule.apply(values) + " " + testOf(rule, 1) + " " + doubleOf(table, 4) + " " + table.double(4) + " " + frozenLooking.triple(4));

const view: MutableRule = rule;
view.test = n => n < 0;
console.log("the field of the class: " + rule.apply(values) + " " + testOf(rule, 1) + " " + rule.test(1) + ", the other " + other.apply(values));

const tableView: { double: (n: number) => number } = table;
tableView.double = n => n + 0.5;
console.log("the member of the literal: " + doubleOf(table, 4) + " " + table.double(4));

const tripleView: { triple: (n: number) => number } = frozenLooking;
tripleView.triple = () => -1;
console.log("the member of the const literal: " + frozenLooking.triple(4));

function replace(target: MutableRule, replacement: (n: number) => boolean): void {
  target.test = replacement;
}

replace(other, n => n === 2);
console.log("through a parameter: " + other.apply(values) + " " + testOf(other, 2));
replace(rule, Number.isNaN);
console.log("a built-in: " + rule.apply(values) + " " + testOf(rule, NaN));
console.log("a new rule: " + new Rule("new").apply(values));

export {};
