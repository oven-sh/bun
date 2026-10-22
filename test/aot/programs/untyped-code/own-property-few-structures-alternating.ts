// A few objects of different shapes are asked for the same names over and over, as a comparison of two objects or a copy of a list of them does. Each question (shape, name) is worked out once; after that nearly all are answered from what is remembered, whichever shapes and names they are.
declare const aotOperationCount: undefined | ((name: string) => number);
const has = (o: any, k: any): boolean => Object.prototype.hasOwnProperty.call(o, k);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTHasOwnProperty") : 0;
const turns = 50;
let yes = 0, asked = 0, workedOut = 0;
function ask(shapes: number, width: number, tag: string) {
  const objects: any[] = [];
  for (let shape = 0; shape < shapes; shape++) {
    let text = "";
    for (let n = 0; n < width; n++) text += `${n ? "," : ""}"${tag}${n}":${shape}`;
    objects.push(JSON.parse(`{${text}${shape ? `,"${tag}more${shape}":1` : ""}}`));
  }
  const names = Object.keys(objects[0]);
  for (const o of objects) for (const k of names) has(o, k);
  const before = entered();
  for (let turn = 0; turn < turns; turn++) for (const o of objects) for (const k of names) yes += +has(o, k);
  asked += turns * shapes * width;
  workedOut += entered() - before;
}
for (let round = 0; round < 12; round++)
  for (const [shapes, width] of [[2, 8], [2, 16], [3, 8], [4, 8]])
    for (const tag of ["p", "name", "aLongerName"]) ask(shapes, width, tag + round + "_" + shapes + "_" + width + "_");
console.log(yes, asked, counted ? workedOut * 20 < asked : true);
