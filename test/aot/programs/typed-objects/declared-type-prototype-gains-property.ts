// An object inherits from an object of a declared type. What the heir is found to lack it may come to inherit: the parent gets a property its type does not declare.
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));

class Request {
  url: unknown = "/";
  next: Request | null = null;
}
interface Point {
  x: number;
  y: number;
}
const makers: [string, () => any][] = [
  ["Request", () => new Request()],
  ["Point", (): Point => ({ x: 1, y: 2 })],
  ["plain", () => ({ plain: true })],
];
function readParams(object: any): unknown {
  return object.params;
}
function hasParams(object: any): boolean {
  return "params" in object;
}
for (const [label, make] of makers) {
  const results: unknown[] = [];
  const parent = make();
  const heir = Object.create(parent);
  const heirOfHeir = Object.create(heir);
  for (let i = 0; i < 3; i++) results.push(String(readParams(heir)), hasParams(heir), String(readParams(heirOfHeir)));
  parent.params = "of the parent";
  for (let i = 0; i < 3; i++) results.push(String(readParams(heir)), hasParams(heir), String(readParams(heirOfHeir)));
  delete parent.params;
  for (let i = 0; i < 3; i++) results.push(String(readParams(heir)), hasParams(heir), String(readParams(heirOfHeir)));
  Object.defineProperty(parent, "params", { get: () => "computed", configurable: true });
  for (let i = 0; i < 3; i++) results.push(String(readParams(heir)), hasParams(heir), String(readParams(heirOfHeir)));
  show(label, results);
}
