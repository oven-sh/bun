interface Extension {
  name: string;
  setup?: () => string;
}

interface Named {
  name: string;
}

const odd: [string, () => Named][] = [
  ["a number", () => ({ name: "number", setup: 5 })],
  ["a function", () => ({ name: "wrong result", setup: () => 5 })],
];

for (const [label, make] of odd) {
  const extension: Extension = make();
  console.log(label + ": " + JSON.stringify(extension.setup));
}

export {};
