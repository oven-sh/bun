class Row {
  id = 7;
  next(): number {
    return this.id + 1;
  }
  twice(): number {
    return this.id * 2;
  }
  both(): number {
    return this.next() + this.twice();
  }
}

type MethodName = "next" | "twice";

function isMethodName(text: string): text is MethodName {
  return text === "next" || text === "twice";
}

function callNext(row: Row): number {
  return row.next();
}

const keys: MethodName[] = ["next", "twice"];
const table = new Map<number, MethodName>([[1, "next"]]);
const parsed: { key: MethodName } = JSON.parse('{"key":"next"}');

let total = 0;
const warm = new Row();
for (let i = 0; i < 2000; i++) total += callNext(warm) + warm.both();
console.log("2000 honest rounds: " + total);

const byList = new Row();
byList[keys[0]] = () => 5;
console.log("a key out of a list: " + byList.next() + " " + callNext(byList) + " " + byList.both() + " " + Object.keys(byList).join());

const byMap = new Row();
const fromMap = table.get(1);
if (fromMap !== undefined) byMap[fromMap] = () => 6;
console.log("a key out of a map: " + byMap.next() + " " + callNext(byMap) + " " + byMap.both());

const byText = new Row();
byText[parsed.key] = () => 7;
console.log("a parsed key: " + byText.next() + " " + callNext(byText) + " " + byText.both());

const byGuard = new Row();
const glued = ["ne", "xt"].join("");
if (isMethodName(glued)) byGuard[glued] = () => 8;
console.log("a glued key behind a guard: " + byGuard.next() + " " + callNext(byGuard) + " " + byGuard.both());

const byLoop = new Row();
for (const key of keys) byLoop[key] = () => 9;
console.log("every key of the list: " + byLoop.next() + " " + byLoop.twice() + " " + byLoop.both());

const exchanged = new Row();
[exchanged[keys[0]], exchanged[keys[1]]] = [exchanged[keys[1]], exchanged[keys[0]]];
console.log("exchanged: " + exchanged.next() + " " + exchanged.twice() + " " + exchanged.both() + " " + Object.keys(exchanged).join());

console.log("an instance that was never touched: " + warm.next() + " " + callNext(warm) + " " + warm.both());

const original = Row.prototype.next;
Row.prototype[keys[0]] = function (this: Row): number {
  return this.id + 100;
};
console.log("on the prototype: " + warm.next() + " " + callNext(warm) + " " + warm.both() + " " + new Row().next() + " " + byList.next());
Row.prototype[keys[0]] = original;
console.log("put back: " + warm.next() + " " + callNext(warm) + " " + warm.both());

export {};
