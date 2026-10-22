interface Options {
  retries?: number;
}
function count(change: Options): number {
  return Object.keys({ ...change }).length;
}
for (let i = 0; i < 2; i++) count({ retries: i });
console.log(count({}));
