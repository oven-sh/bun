interface Options {
  retries: number;
  label: string;
}
const defaults: Options = { retries: 3, label: "job" };
function withOptions(change: Partial<Options>): Options {
  return { ...defaults, ...change };
}
for (let i = 0; i < 2; i++) withOptions({ retries: i });
console.log(withOptions({}).label);
