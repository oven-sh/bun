interface Draft {
  title: string;
  body?: string;
  pages?: number;
  done?: boolean;
}

function state(d: Draft): string {
  return Object.keys(d).join() + " " + JSON.stringify(d) + " " + [d.title, d.body, d.pages, d.done].join("/");
}

function pages(d: Draft): number {
  return d.pages ?? 0;
}

function addPages(d: Draft, n: number): void {
  d.pages = n;
}

function removePages(d: Draft): boolean {
  return delete d.pages;
}

const declaredOrder: Draft = { title: "t", body: "b", pages: 1, done: true };
console.log("all four: " + state(declaredOrder));
delete declaredOrder.body;
console.log("body deleted: " + state(declaredOrder));
declaredOrder.body = "again";
console.log("body added again, now last: " + state(declaredOrder));
delete declaredOrder.pages;
delete declaredOrder.done;
console.log("two more deleted: " + state(declaredOrder));
declaredOrder.done = false;
declaredOrder.pages = 2;
console.log("added in the other order: " + state(declaredOrder));

const grown: Draft = { title: "grown" };
grown.done = true;
grown.pages = 3;
grown.body = "late";
console.log("added backwards: " + state(grown));
console.log("its copy keeps that order: " + state({ ...grown }));

const toggled: Draft = { title: "toggled" };
const seen: string[] = [];
for (let i = 0; i < 6; i++) {
  if (i % 2 === 0) addPages(toggled, i);
  else removePages(toggled);
  seen.push(pages(toggled) + ":" + ("pages" in toggled) + ":" + Object.keys(toggled).length);
}
console.log("added and deleted in a loop: " + seen.join(" "));

const steady: Draft = { title: "steady", pages: 1 };
let sum = 0;
for (let i = 0; i < 2000; i++) sum += pages(steady);
console.log("2000 reads while it is there: " + sum);
removePages(steady);
console.log("deleted: " + pages(steady) + " " + state(steady));
addPages(steady, 7);
console.log("added: " + pages(steady) + " " + state(steady));

let total = 0;
const looped: Draft = { title: "looped", pages: 1, done: true };
for (let i = 0; i < 2000; i++) {
  total += looped.pages ?? 100;
  if (i === 999) delete looped.pages;
  if (i === 1499) looped.pages = 2;
}
console.log("deleted and added inside one loop: " + total + " " + state(looped));

class Shelf {
  draft: Draft = { title: "shelf", pages: 4 };
  drafts: Draft[] = [{ title: "a", pages: 1 }, { title: "b" }, { pages: 3, title: "c" }];
  strip(): void {
    delete this.draft.pages;
    for (const d of this.drafts) delete d.pages;
  }
  fill(): void {
    this.draft.pages = 9;
    for (const d of this.drafts) d.pages = 9;
  }
  show(): string {
    return state(this.draft) + " | " + this.drafts.map(state).join(" | ");
  }
}

const shelf = new Shelf();
console.log("shelf: " + shelf.show());
shelf.strip();
console.log("stripped: " + shelf.show());
shelf.fill();
console.log("filled: " + shelf.show());

const set: Draft = { title: "set to undefined", pages: 5 };
set.pages = undefined;
console.log("stored undefined is not deleted: " + state(set) + " " + ("pages" in set));

const aliasTarget = { title: "required", pages: 6 };
const alias: Draft = aliasTarget;
delete alias.pages;
console.log("deleted through an alias that says optional: " + typeof aliasTarget.pages + " " + (aliasTarget.pages + 1) + " " + (aliasTarget.pages | 0) + " " + JSON.stringify(aliasTarget));

export {};
