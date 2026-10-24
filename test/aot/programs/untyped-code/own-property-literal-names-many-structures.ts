// `Object.hasOwn(o, "name")` and `o.hasOwnProperty("name")` with the name written out, asked of objects of sixteen shapes in turn. Each question (shape, name) is worked out once; after that nearly all are answered from what is remembered, whichever shapes they are.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTHasOwnProperty") : 0;
function ask(o: any): number {
  return (Object.hasOwn(o, "alpha") ? 1 : 0) + (Object.hasOwn(o, "beta") ? 1 : 0) + (o.hasOwnProperty("gamma") ? 1 : 0) + (Object.prototype.hasOwnProperty.call(o, "delta") ? 1 : 0);
}
const turns = 40, shapes = 16;
let yes = 0, asked = 0, workedOut = 0;
for (let round = 0; round < 60; round++) {
  const objects: any[] = [];
  for (let shape = 0; shape < shapes; shape++) objects.push(JSON.parse(`{"alpha":1,"gamma":2,"r${round}s${shape}":3}`));
  for (const o of objects) ask(o);
  const before = entered();
  for (let turn = 0; turn < turns; turn++) for (const o of objects) yes += ask(o);
  asked += turns * shapes * 4;
  workedOut += entered() - before;
}
console.log(yes, asked, counted ? workedOut * 20 < asked : true);
