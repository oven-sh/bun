const makers = {
  point: [() => ({ x: 1, y: 2 }), () => ({ y: 2, x: 1 }), () => ({ x: "1", y: 2 }), () => ({ x: 1 }), () => [1, 2], () => "xy", () => 5, () => null, () => undefined],
  dog: [
    () => ({ legs: 3, name: "literal", bark() { return "literal bark"; } }),
    () => ({ name: "other order", legs: "three" }),
    () => ({}),
    () => new (class Dog { legs = "class of the same name"; bark() { return -1; } })(),
    () => Object.create({ legs: 5, name: "inherited", bark() { return this.legs; } }),
    () => new Proxy({ legs: 6, name: "proxy", bark() { return 60; } }, {}),
    () => "dog",
    () => 7,
    () => null,
  ],
  shape: [() => ({ kind: "circle", radius: 1 }), () => ({ kind: "circle", side: 2 }), () => ({ kind: "triangle" }), () => ({ radius: 1 }), () => ({ kind: "square", side: "2" }), () => null],
  color: [() => 0, () => 1, () => 7, () => "Red", () => 0.5, () => null],
};

export function count(kind) {
  return makers[kind].length;
}
export function makePoint(i) {
  return makers.point[i]();
}
export function makeDog(i) {
  return makers.dog[i]();
}
export function makeShape(i) {
  return makers.shape[i]();
}
export function makeColor(i) {
  return makers.color[i]();
}
export function makeDogs() {
  return makers.dog.slice(0, 3).map(make => make());
}

const spoilers = [
  dog => { dog.legs = "many"; },
  dog => { delete dog.legs; },
  dog => { dog.bark = () => "own bark"; },
  dog => { Object.setPrototypeOf(dog, { bark() { return "other prototype"; } }); },
  dog => { Object.setPrototypeOf(dog, null); },
  dog => { Object.defineProperty(dog, "legs", { get() { return "getter"; }, configurable: true }); },
  dog => { Object.freeze(dog); },
  dog => { dog.extra = 1; delete dog.name; dog.name = 5; },
];
export const spoilerCount = spoilers.length;
export function spoil(dog, i) {
  spoilers[i](dog);
}
export function fillKennel(kennel) {
  kennel.dogs.push({ legs: "pushed" }, null);
  kennel.at = "nowhere";
}
