function kinds(value: object): string {
  return Object.keys(value)
    .map(key => typeof Reflect.get(value, key))
    .join();
}
class Stranger {}
function run(): void {
  const raw: unknown = new Stranger();
  let reads = 0;
  const holder = {
    get value(): unknown {
      return reads++ === 0 ? 1 : raw;
    },
  };
  console.log("first " + kinds(holder));
  console.log("second " + kinds(holder));
}
run();
