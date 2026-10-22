// The sum is a number on the likely path only. Typing the loop without its unlikely path finds code that cannot run.
globalThis.hook = x => x;
function round(name) {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += globalThis[name](i);
  return sum;
}
console.log(round(JSON.parse('"hook"')));
globalThis.hook = x => "<" + x + ">";
console.log(round(JSON.parse('"hook"')));
globalThis.hook = x => (x === 4 ? "four" : x);
console.log(round(JSON.parse('"hook"')));
globalThis.hook = x => (x === 4 ? 10n : x === 5 ? { valueOf: () => 1n } : BigInt(x));
try {
  console.log(round(JSON.parse('"hook"')));
} catch (error) {
  console.log(error instanceof TypeError);
}
