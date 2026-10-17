// A record copied into a wider type, behind a field or without some fields, is of the literal's type by construction: the usual path neither tests the copy for null nor casts it.
// SIZE< weigh 400
// SIZE< withoutLabel 344
type Point = { x: number; y: number; label?: string };
type Weighted = { weight: number; x: number; y: number; label?: string };
function weigh(point: Point, weight: number): Weighted { return { weight, ...point }; }
function withoutLabel(point: Point): { x: number; y: number } { const { label, ...rest } = point; return rest; }
const weighers: ((point: Point, weight: number) => Weighted)[] = [weigh];
const strippers: ((point: Point) => { x: number; y: number })[] = [withoutLabel];
const plain: Point = { x: 1, y: 2 };
const labeled: Point = { x: 3, y: 4, label: "l" };
const marked: Point = { x: 5, y: 6 };
(marked as Point & { mark?: number }).mark = 1;
const frozen: Point = Object.freeze({ x: 7, y: 8, label: "f" });
for (let round = 0; round < 3; round++) {
  for (const point of [plain, labeled, marked, frozen]) {
    const weighted = weighers[0]!(point, round + 0.5);
    const stripped = strippers[0]!(point);
    console.log(JSON.stringify(weighted), Object.keys(weighted).join(), weighted.weight + weighted.x + weighted.y, weighted.label, Object.isFrozen(weighted));
    console.log(JSON.stringify(stripped), Object.keys(stripped).join(), stripped.x + stripped.y, Object.isFrozen(stripped));
  }
}
let total = 0;
for (let i = 0; i < 30000; i++) {
  const point = i & 1 ? plain : labeled;
  total += weighers[0]!(point, i).weight + strippers[0]!(point).y;
}
console.log(total);
