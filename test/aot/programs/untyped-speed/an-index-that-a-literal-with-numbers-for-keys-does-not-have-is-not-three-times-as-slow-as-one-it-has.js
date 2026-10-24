// A table written as a literal with numbers for keys is asked by a function that knows nothing of it: for a number that it has, and for one that it does not have, which is what most questions to such a
// table find. Nothing above the table has elements, so "not there" is known as soon as the table's own elements are looked at, and may cost about what "there" costs.
const hidden = process.argv.length > 99 ? process.argv[9] : "hidden";
globalThis[hidden] = [{ 204: true, 205: true, 304: true }, { 300: true, 301: true, 302: true, 303: true, 305: true, 307: true, 308: true }];
function ask(table, code) { return table[code]; }
function fastestOf(runs, first, second) {
  const [empty, redirect] = globalThis.hidden;
  let fastest = Infinity, found = 0;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    for (let i = 0; i < 1000000; i++) { if (ask(empty, first + (i & 1))) found++; if (ask(redirect, second + (i & 1))) found++; }
    fastest = Math.min(fastest, performance.now() - began);
  }
  return { fastest, found };
}
const there = fastestOf(5, 204, 300), notThere = fastestOf(5, 200, 200);
console.log(there.found, notThere.found);
console.log(notThere.fastest < there.fastest * 3 ? "not there in under three times the time of there" : "not there took over three times the time of there");
