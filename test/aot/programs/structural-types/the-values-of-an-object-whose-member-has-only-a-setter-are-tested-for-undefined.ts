interface Account {
  label: string;
  x: number;
}
function probe(account: Account): string {
  const values = Object.values(account);
  return values.length + " " + values.map(each => typeof each).join() + " " + values.some(each => each === undefined) + " " + String(values[1]);
}
console.log("honest " + probe({ label: "cd", x: 1.5 }));
const victim: Account = { label: "cd", set x(value: number) {} };
console.log("victim " + probe(victim));
