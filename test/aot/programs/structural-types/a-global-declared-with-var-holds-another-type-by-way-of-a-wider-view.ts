function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  var looseCount: number;
  var looseTitle: string;
  var loosePoint: { x: number; y: number };
  var looseList: number[];
}

const wide: { looseCount: number | string; looseTitle: string | number; loosePoint: { x: number | string; y?: number }; looseList: ArrayLike<number> } = globalThis;

function countPlusOne(): number {
  return looseCount + 1;
}

function titleLength(): number {
  return looseTitle.length;
}

function pointSum(): number {
  return loosePoint.x + loosePoint.y;
}

function listTotal(): number {
  let sum = 0;
  for (const n of looseList) sum += n;
  return sum;
}

function all(label: string): void {
  show(label + ": the number", () => [looseCount, typeof looseCount, countPlusOne(), looseCount * 2]);
  show(label + ": the text", () => [looseTitle, typeof looseTitle, titleLength()]);
  show(label + ": the text in capitals", () => looseTitle.toUpperCase());
  show(label + ": the point", () => [loosePoint.x, loosePoint.y, pointSum(), Object.keys(loosePoint)]);
  show(label + ": the list", () => [looseList.length, looseList[0], Array.isArray(looseList)]);
  show(label + ": the list added up", () => listTotal());
}

globalThis.looseCount = 1;
globalThis.looseTitle = "title";
globalThis.loosePoint = { x: 1, y: 2 };
globalThis.looseList = [1, 2];
all("honest");

let sum = 0;
for (let i = 0; i < 2000; i++) sum += countPlusOne() + titleLength() + pointSum() + listTotal();
show("2000 honest rounds", () => sum);

wide.looseCount = "one";
wide.looseTitle = 12;
wide.loosePoint = { x: "x" };
wide.looseList = { length: 1, 0: 7 };
all("through the wider view");

globalThis.looseCount = 2;
globalThis.looseTitle = "again";
globalThis.loosePoint = { x: 3, y: 4 };
globalThis.looseList = [5];
all("honest again");

export {};
