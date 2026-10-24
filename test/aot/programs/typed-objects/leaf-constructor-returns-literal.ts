// A constructor may return another object than `this`. Whatever it returns is of the type of a class without members.
class Maker { constructor(i: number) { return { g: i } } }
for (let round = 0; round < 3; round++) {
  const made = new Maker(round);
  console.log((made as { g?: number }).g, made instanceof Maker, Object.keys(made).join());
}
