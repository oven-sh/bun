// `Object.hasOwn(o, key)` over thirty-two shapes and four keys in turn, sixty times over with new shapes each time, as a server meets them. What is remembered about shapes that are no longer asked about does not stand in the way of those that are: each question (shape, key) is worked out once, and nearly all after that are answered from what is remembered.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTHasOwnProperty") : 0;
const keys: any[] = ["alpha", "beta", "gamma", "delta"];
function ask(o: any, key: any): number { return Object.hasOwn(o, key) ? 1 : 0; }
const turns = 40, shapes = 32;
let yes = 0, asked = 0, workedOut = 0;
for (let round = 0; round < 60; round++) {
  const objects: any[] = [];
  for (let shape = 0; shape < shapes; shape++) objects.push(JSON.parse(`{"alpha":1,"gamma":2,"r${round}s${shape}":3}`));
  for (const o of objects) for (const key of keys) ask(o, key);
  const before = entered();
  for (let turn = 0; turn < turns; turn++) for (const o of objects) for (const key of keys) yes += ask(o, key);
  asked += turns * shapes * keys.length;
  workedOut += entered() - before;
}
console.log(yes, asked, counted ? workedOut * 20 < asked : true);
