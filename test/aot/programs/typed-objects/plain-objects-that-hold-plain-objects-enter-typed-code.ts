// Plain objects that untyped code made, holding further plain objects, enter typed functions, typed variables and typed arrays: every one keeps its identity, its keys and its values, however deep, shared or cyclic the graph is.
type Leaf = { n: number; label: string };
type Branch = { id: number; leaf: Leaf; other: Leaf | null; more?: Leaf };
type Chain = { depth: number; next: Chain | null };
type Ring = { name: string; partner: Ring | null; leaf: Leaf };
type Circle = { kind: "circle"; radius: number };
type Square = { kind: "square"; side: number };
type Drawing = { title: string; shape: Circle | Square; spare: Circle | Square | null };
type Basket = { owner: string; items: Leaf[]; nested: Branch[] };

const lines: string[] = [];
const say = (label: string, ...values: unknown[]) => lines.push(label + ": " + values.map(value => JSON.stringify(value) ?? "undefined").join(" "));
const outside = (text: string): any => JSON.parse(text);
const grown = (pairs: [string, unknown][]): any => {
  const object: any = {};
  for (const [key, value] of pairs) object[key] = value;
  return object;
};
const leafOf = (n: number): any => {
  const leaf: any = { n };
  leaf.label = "leaf" + n;
  return leaf;
};
const branchOf = (id: number, leaf: unknown, other: unknown): any => {
  const branch: any = { id };
  branch.leaf = leaf;
  branch.other = other;
  return branch;
};

function sumBranch(branch: Branch): number {
  return branch.id + branch.leaf.n + (branch.other === null ? 0 : branch.other.n) + (branch.more === undefined ? 0 : branch.more.n) + branch.leaf.label.length;
}
function lengthOf(chain: Chain): number {
  let length = 0;
  for (let at: Chain | null = chain; at !== null && length < 40; at = at.next) length += 1 + at.depth * 0;
  return length;
}
function ringText(ring: Ring): string {
  return ring.name + ">" + (ring.partner === null ? "nobody" : ring.partner.name) + ":" + ring.leaf.label;
}
function area(shape: Circle | Square): number {
  return shape.kind === "circle" ? shape.radius * shape.radius * 3 : shape.side * shape.side;
}
function describeDrawing(drawing: Drawing): string {
  return drawing.title + "=" + area(drawing.shape) + "/" + (drawing.spare === null ? "none" : area(drawing.spare));
}
function totalOf(basket: Basket): number {
  let total = basket.owner.length;
  for (let i = 0; i < basket.items.length; i++) total += basket.items[i].n;
  for (let i = 0; i < basket.nested.length; i++) total += sumBranch(basket.nested[i]);
  return total;
}

for (let round = 0; round < 6; round++) {
  const leaf = leafOf(round);
  const other = round % 2 ? leafOf(round + 10) : null;
  const branch = branchOf(round, leaf, other);
  const sum = sumBranch(branch);
  say("branch " + round, sum, branch.leaf === leaf, branch.other === other, Object.keys(branch), Object.keys(leaf), branch);
  leaf.n = 100;
  say("after a store from outside " + round, sumBranch(branch), leaf.n);
  (branch as Branch).leaf.n = 7;
  say("after a typed store " + round, leaf.n, sumBranch(branch));
}

for (let round = 0; round < 4; round++) {
  const shared = leafOf(round);
  const first = branchOf(1, shared, shared);
  const second = branchOf(2, shared, null);
  say("a shared leaf " + round, sumBranch(first), sumBranch(second), first.leaf === second.leaf, first.leaf === first.other);
  const withMore = branchOf(3, leafOf(1), null);
  withMore.more = round % 2 ? shared : leafOf(50);
  say("an optional leaf " + round, sumBranch(withMore), Object.keys(withMore));
}

for (const depth of [1, 2, 3, 4, 5, 6, 7, 12]) {
  for (let round = 0; round < 3; round++) {
    let chain: any = null;
    const all: any[] = [];
    for (let i = 0; i < depth; i++) {
      const link: any = { depth: i };
      link.next = chain;
      chain = link;
      all.push(link);
    }
    const length = lengthOf(chain);
    let same = true;
    for (let at = chain, i = depth - 1; at !== null; at = at.next, i--) same = same && at === all[i];
    if (round === 2) say("a chain of " + depth, length, same, JSON.stringify(chain).length);
  }
}

for (let round = 0; round < 4; round++) {
  const alone: any = { name: "alone" };
  alone.partner = alone;
  alone.leaf = leafOf(1);
  say("its own partner " + round, ringText(alone), alone.partner === alone, alone.partner.partner.leaf === alone.leaf);
  const left: any = { name: "left" };
  const right: any = { name: "right" };
  left.partner = right;
  left.leaf = leafOf(2);
  right.partner = left;
  right.leaf = left.leaf;
  say("two partners " + round, ringText(left), ringText(right), left.partner.partner === left, right.leaf === left.leaf);
}

for (let round = 0; round < 6; round++) {
  const shape = round % 2 ? grown([["kind", "circle"], ["radius", round]]) : grown([["kind", "square"], ["side", round]]);
  const spare = round % 3 === 0 ? null : round % 3 === 1 ? grown([["kind", "square"], ["side", 2]]) : shape;
  const drawing = grown([["title", "drawing" + round], ["shape", shape], ["spare", spare]]);
  say("a drawing " + round, describeDrawing(drawing), drawing.shape === shape, drawing.spare === spare, drawing);
}

for (let round = 0; round < 4; round++) {
  const basket = outside(`{"owner":"somebody","items":[{"n":1,"label":"a"},{"n":2,"label":"b"},{"n":${round},"label":"c"}],"nested":[{"id":1,"leaf":{"n":5,"label":"x"},"other":null},{"id":2,"leaf":{"n":6,"label":"y"},"other":{"n":7,"label":"z"}}]}`);
  const items = basket.items;
  const first = items[0];
  const deep = basket.nested[1].other;
  say("a parsed basket " + round, totalOf(basket), basket.items === items, items[0] === first, basket.nested[1].other === deep, basket);
  items.push(leafOf(40));
  items[1] = leafOf(41);
  say("the basket after stores from outside " + round, totalOf(basket), items.length);
}

for (let round = 0; round < 4; round++) {
  const surplus = leafOf(round);
  surplus.surplus = "kept";
  const frozen = Object.freeze(leafOf(round + 1));
  const computed: any = { n: round };
  Object.defineProperty(computed, "label", { get: () => "computed", enumerable: true, configurable: true });
  const inherits = Object.assign(Object.create({ inherited: true }), { n: round, label: "heir" });
  say("a leaf with a key more " + round, sumBranch(branchOf(1, surplus, null)), Object.keys(surplus), surplus.surplus);
  say("a frozen leaf " + round, sumBranch(branchOf(1, frozen, frozen)), Object.isFrozen(frozen));
  say("a computed label " + round, sumBranch(branchOf(1, computed, null)), Object.getOwnPropertyDescriptor(computed, "label")!.get !== undefined);
  say("a leaf with a prototype " + round, sumBranch(branchOf(1, inherits, null)), inherits.inherited, Object.getPrototypeOf(inherits).inherited);
  const fraction = leafOf(0);
  fraction.n = round + 0.5;
  say("a fraction " + round, sumBranch(branchOf(1, fraction, null)), fraction.n);
}

const typedLeaf: Leaf = { n: 3, label: "typed" };
for (let round = 0; round < 4; round++) {
  const mixed = branchOf(round, typedLeaf, leafOf(round));
  say("a typed and a plain leaf " + round, sumBranch(mixed), mixed.leaf === typedLeaf);
  const list: any[] = [typedLeaf, leafOf(1), typedLeaf, leafOf(2)];
  say("a mixed array " + round, totalOf(grown([["owner", "x"], ["items", list], ["nested", []]])), list[0] === typedLeaf, list.length);
}
console.log(lines.join("\n"));
