// TypeScript narrows `current` to number at an assignment or a test and does not see that a call resets it. What is computed from it must be what JavaScript computes from undefined.
let current: number | undefined = 3;
function clear(): void { current = undefined; }
function reset(): number { current = 3; clear(); return current; }
function show(label: string, make: () => unknown): void {
  let text: string;
  try { const value = make(); text = typeof value + " " + String(value); } catch (error) { text = "throws " + (error as Error).constructor.name; }
  console.log(label + ": " + text);
}
function plusOne(n: number): number { return n + 1; }
function product(n: number): number { return n * 2; }
function remainder(n: number): number { return n % 2; }
function negated(n: number): number { return -n; }
function inText(n: number): string { return `<${n + 1}>`; }
function element(n: number): number | undefined { return [10, 20, 30][n + 1]; }
function arm(n: number): string { switch (n + 1) { case 0: return "zero"; case 1: return "one"; case 4: return "four"; default: return "other"; } }
function counted(n: number): number { let total = n; total++; total += 2; return total; }
function orZero(n: number): number { return (n + 1) | 0; }
let kept = 4;
show("a let, in place", () => { current = 3; clear(); let moved = 4; moved = current; return moved + 1; });
show("a let, times", () => { current = 3; clear(); let moved = 4; moved = current; return moved * 2; });
show("a let, incremented", () => { current = 3; clear(); let moved = 4; moved = current; moved++; return moved; });
show("a let, added to", () => { current = 3; clear(); let moved = 4; moved = current; moved += 2; return moved; });
show("a let, a sum as an index", () => { current = 3; clear(); let moved = 4; moved = current; return [10, 20, 30][moved + 1]; });
show("a let, a sum of sums", () => { current = 3; clear(); let moved = 4; moved = current; return (moved + 1) + (moved + 2); });
show("a let, in a template", () => { current = 3; clear(); let moved = 4; moved = current; return `${moved + 1}`; });
show("a module variable", () => { current = 3; clear(); kept = current; return kept + 1; });
show("a loop variable", () => { current = 3; clear(); let sum = 0; for (let i = current; sum < 1; sum++) { return i + 1; } return sum; });
show("inside try", () => { current = 3; clear(); let moved = 4; try { moved = current; } finally { kept = 4; } return moved - 1; });
show("a constant, a call", () => { current = 3; clear(); const held = current; return plusOne(held); });
show("a closure, a call", () => { current = 3; clear(); const held = current; return (() => plusOne(held))(); });
show("a conditional, a call", () => { current = 3; clear(); return plusOne(kept > 0 ? current : 5); });
show("after a test", () => { current = 3; if (current !== undefined) { clear(); return current + 1; } return 0; });
show("a result", () => reset() + 1);
show("a call: plus one", () => { current = 3; clear(); return plusOne(current); });
show("a call: product", () => { current = 3; clear(); return product(current); });
show("a call: remainder", () => { current = 3; clear(); return remainder(current); });
show("a call: negated", () => { current = 3; clear(); return negated(current); });
show("a call: in a template", () => { current = 3; clear(); return inText(current); });
show("a call: an element", () => { current = 3; clear(); return element(current); });
show("a call: a switch", () => { current = 3; clear(); return arm(current); });
show("a call: counted", () => { current = 3; clear(); return counted(current); });
show("a call: or zero", () => { current = 3; clear(); return orZero(current); });
show("honest: a let", () => { current = 3; let moved = 4; moved = current; return moved + 1; });
show("honest: a call", () => { current = 3; return plusOne(current) + product(current) + counted(current); });
show("honest: a switch", () => { current = 3; return arm(current) + inText(current) + String(element(current - 3)); });
