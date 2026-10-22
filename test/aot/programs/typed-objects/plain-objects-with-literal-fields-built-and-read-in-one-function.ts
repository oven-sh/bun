// Plain objects with a field written as a union of string literals are built and read in one function. Any string is taken and read back, a constant or not, of the union or outside it: a literal type promises the kind. A number in that field throws a TypeError at the typed read.
type Author = { login: string };
type Hit = { id: number; state: "open" | "closed"; author: Author };
const makeAuthor = (login: string): Author => ({ login });
const makeHit = (id: number, author: Author): Hit => ({ id, state: "open", author });
const read = (hit: Hit) => hit.id + (hit.state === "closed" ? 1 : 2) + hit.state.length + hit.author.login.length;
const author = makeAuthor("u");
let kept: any;
let turn = 0;
const anything = (value: unknown): any => value;
const say = (label: string, run: () => number) => {
  for (let i = 0; i < 4; i++) {
    try {
      console.log(label, i, run());
    } catch (error) {
      console.log(label, i, error instanceof TypeError ? "TypeError" : String(error));
    }
  }
};

console.log(read(makeHit(1, author)));
say("a constant of the union", () => {
  const hit: any = { id: 1, state: "closed", author };
  kept = hit;
  return read(hit);
});
console.log(kept.state, Object.keys(kept).join());
say("one of two constants", () => {
  const hit: any = { id: 2, state: turn++ & 1 ? "open" : "closed", author };
  kept = hit;
  return read(hit);
});
say("one of two constants, nothing else holds it", () => {
  const hit: any = { id: 3, state: turn++ & 1 ? "open" : "closed", author };
  return read(hit);
});
say("a constant outside the union", () => {
  const hit: any = { id: 4, state: "merged", author };
  kept = hit;
  return read(hit);
});
say("one of two constants, one outside the union", () => {
  const hit: any = { id: 5, state: turn++ & 1 ? "open" : "merged", author };
  kept = hit;
  return read(hit);
});
say("a string that is not a constant, which fits", () => {
  const hit: any = { id: 6, state: anything("clo" + "sed".slice(turn & 0)), author };
  kept = hit;
  return read(hit);
});
say("a string that is not a constant, which does not fit", () => {
  const hit: any = { id: 7, state: anything("mer" + "ged".slice(turn & 0)), author };
  kept = hit;
  return read(hit);
});
say("a number", () => {
  const hit: any = { id: 8, state: 1, author };
  kept = hit;
  return read(hit);
});
say("lacks it", () => {
  const hit: any = { id: 9, author };
  kept = hit;
  return read(hit);
});
say("stored twice, the second outside the union", () => {
  const hit: any = { id: 10, state: "open", author };
  hit.state = "merged";
  kept = hit;
  return read(hit);
});
say("stored twice, the second inside the union", () => {
  const hit: any = { id: 11, state: "merged", author };
  hit.state = "open";
  kept = hit;
  return read(hit);
});
console.log(turn, kept.state);
