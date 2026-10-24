type Fixable = { toFixed(digits: number): string };

function money(amount: Fixable): string {
  return amount.toFixed(2);
}

console.log("start");
console.log("money", money(new Number(7.25)));
