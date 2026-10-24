interface Clock { origin: number; next: Clock | null }
class Link {
  value = 1;
  after: Link | null = null;
}
declare function fromHost(which: number): Clock;
const raws: any[] = [0, 1].map(() => JSON.parse('{"origin":1,"next":null}'));
for (const raw of raws) { raw.next = raw; }
(globalThis as any).fromHost = (which: number) => raws[which];
const kept: Clock = fromHost(0);
console.log(kept.next === kept, kept.origin, raws[1].next === raws[1]);
const bag = new Map<string, any>();
bag.set("link", new Link());
bag.set("plain", { value: 2, after: null });
bag.set("frozen", Object.freeze(new Link()));
const tie = (link: any) => {
  link.after = link;
  return link.value;
};
for (let turn = 0; turn < 3; turn++) {
  for (const name of ["link", "plain", "frozen", "nothing"]) {
    try {
      console.log(name, tie(bag.get(name)), bag.get(name).after === bag.get(name));
    } catch (error) {
      console.log(name, error instanceof TypeError ? "TypeError" : String(error));
    }
  }
}
