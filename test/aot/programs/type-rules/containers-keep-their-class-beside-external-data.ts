// A Map, a Set or an array that the program makes stays a Map, a Set or an array when external data is put into it: only its elements are no longer trusted.
// IR+ CallBuiltin v\d+ \(.*\) overload=MapPrototypeSet/
// IR+ CallBuiltin v\d+ \(.*\) overload=MapPrototypeGet/
// IR+ CallBuiltin v\d+ \(.*\) overload=MapPrototypeHas/
// IR+ CallBuiltin v\d+ \(.*\) overload=SetPrototypeAdd/
// IR+ ^ .* = SetNext 
// IR+ CallBuiltin v\d+ \(.*\) overload=ArrayPrototypeIndexOf/
// IR+ CallBuiltin v\d+ \(.*\) overload=ArrayPrototypeIncludes/
// IR+ CallBuiltin v\d+ \(.*\) overload=ArrayPrototypeLength/
// IR- CallMethod v\d+ \(.*\) name="(get|set|has|delete|add|indexOf|includes)"(?!.* isFallback)
const data = JSON.parse('{"t":"abc","list":[1,2]}') as { t: number; list: number[] };
function mapOperations(): string {
  const m = new Map([[1, 2]]);
  m.set(2, data.t);
  return [m.size, m.has(2), m.get(1), m.get(2), m.delete(1), m.size].join();
}
function setOperations(): string {
  const s = new Set([1]);
  s.add(data.t);
  let seen = "";
  for (const v of s) seen += v;
  return [s.size, s.has(1), seen].join();
}
function arrayOperations(): string {
  const copy = [...data.list, data.t];
  copy.push(4);
  let seen = "";
  for (let i = 0; i < copy.length; i++) seen += copy[i];
  return [copy.length, copy.indexOf(2), copy.includes(4), seen].join();
}
console.log(mapOperations(), setOperations(), arrayOperations());
