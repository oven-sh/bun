function countOf(o: { count: number }): number {
  return o.count;
}
function counter(): number {
  return 1;
}
counter.count = 5;
console.log("count " + countOf(counter));
console.log("count " + countOf({ count: 6 }));
