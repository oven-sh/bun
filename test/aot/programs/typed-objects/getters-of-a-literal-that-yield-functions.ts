function memoizeOne<A extends object, T>(callback: (argument: A) => T): (argument: A) => T {
  const known = new Map<A, T>();
  return argument => {
    let value = known.get(argument);
    if (value === undefined) {
      value = callback(argument);
      known.set(argument, value);
    }
    return value;
  };
}
interface Rules {
  depth: number;
}
interface Factory {
  rules: Rules;
  make(kind: number): number;
  count: number;
}
let built = 0;
function rulesOf(): Rules {
  built++;
  return { depth: built };
}
function describe(factory: Factory): string {
  return factory.make(1) + "," + factory.rules.depth + "," + factory.count;
}
const described = memoizeOne(describe);

interface Tools {
  add(a: number, b: number): number;
  twice(a: number): number;
  name: string;
}
let created = 0;
function binary(by: number): (a: number, b: number) => number {
  created++;
  return (a, b) => (a + b) * by;
}
function createTools(): Tools {
  const tools: Tools = {
    get add() {
      return binary(1);
    },
    get twice() {
      const add = tools.add;
      return (a: number) => add(a, a);
    },
    name: "tools",
  };
  return tools;
}
function useTools(tools: Tools): number {
  return tools.add(1, 2) + tools.twice(5);
}
const used = memoizeOne(useTools);
const tools = createTools();
console.log(used(tools), useTools(tools), created, tools.name, tools.add === tools.add);
const { add, twice } = tools;
console.log(add(2, 3), twice(4), created);
