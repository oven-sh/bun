function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Size {
  Small,
  Medium,
  Large,
}

interface Box {
  width: number;
  label: string;
}

function textOf(size: Size): string {
  let text: string;
  switch (size) {
    case Size.Small:
      text = "small";
      break;
    case Size.Medium:
      text = "medium";
      break;
    case Size.Large:
      text = "large";
      break;
  }
  return text;
}

function widthOf(size: Size): number {
  let width: number;
  switch (size) {
    case Size.Small:
      width = 1;
      break;
    case Size.Medium:
      width = 2;
      break;
    case Size.Large:
      width = 3;
      break;
  }
  return width;
}

function halfWidthOf(size: Size): number {
  let width: number;
  switch (size) {
    case Size.Small:
      width = 0.5;
      break;
    case Size.Medium:
      width = 1.5;
      break;
    case Size.Large:
      width = 2.5;
      break;
  }
  return width * 2;
}

function isBig(size: Size): boolean {
  let big: boolean;
  switch (size) {
    case Size.Small:
    case Size.Medium:
      big = false;
      break;
    case Size.Large:
      big = true;
      break;
  }
  return big;
}

function boxOf(size: Size): Box {
  let box: Box;
  switch (size) {
    case Size.Small:
      box = { width: 1, label: "s" };
      break;
    case Size.Medium:
      box = { width: 2, label: "m" };
      break;
    case Size.Large:
      box = { width: 3, label: "l" };
      break;
  }
  return box;
}

function makerOf(size: Size): () => number {
  let make: () => number;
  switch (size) {
    case Size.Small:
      make = () => 1;
      break;
    case Size.Medium:
      make = () => 2;
      break;
    case Size.Large:
      make = () => 3;
      break;
  }
  return make;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const size: Size = i % 3;
  warm += textOf(size).length + widthOf(size) + halfWidthOf(size) + (isBig(size) ? 1 : 0) + boxOf(size).width + makerOf(size)();
}
console.log("2000 honest rounds", warm);

const numbers: number[] = [3, -1, 1.5, NaN, 2 ** 31];
for (const n of numbers) {
  const size: Size = n;
  const label = show(n);
  attempt(label + " text", () => textOf(size));
  attempt(label + " text is used", () => textOf(size).toUpperCase());
  attempt(label + " text is joined", () => textOf(size) + "!");
  attempt(label + " width", () => widthOf(size));
  attempt(label + " width is used", () => [widthOf(size) + 1, widthOf(size) | 0, typeof widthOf(size)]);
  attempt(label + " half width", () => halfWidthOf(size));
  attempt(label + " big", () => [isBig(size), isBig(size) ? "yes" : "no", typeof isBig(size)]);
  attempt(label + " box", () => boxOf(size));
  attempt(label + " box is used", () => boxOf(size).width);
  attempt(label + " maker", () => typeof makerOf(size));
  attempt(label + " maker is called", () => makerOf(size)());
}
attempt("kept in typed places", () => {
  const odd: Size = numbers[0];
  const texts: string[] = [textOf(Size.Small), textOf(odd)];
  const widths: number[] = [widthOf(Size.Large), widthOf(odd), halfWidthOf(odd)];
  return [texts, widths, texts.join("+"), widths.reduce((sum, width) => sum + width, 0)];
});
attempt("honest again", () => [textOf(Size.Large), widthOf(Size.Medium), halfWidthOf(Size.Small), isBig(Size.Large), boxOf(Size.Small), makerOf(Size.Medium)()]);
