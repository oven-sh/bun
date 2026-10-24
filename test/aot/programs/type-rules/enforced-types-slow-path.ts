// Functions that run once, whose written types are false, and null and undefined in reference slots that are then called and read.
function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label, "returned", body());
  } catch (error) {
    console.log(label, "threw", error instanceof TypeError ? "TypeError" : "another error");
  }
}

class Point {
  x: number = 1;
  y: number = 2;
}

type Mode = "fast" | "slow" | 1;
type Small = 1 | 2 | 3;

function takesNumber(value: number): string {
  return "number " + value;
}
function takesMode(mode: Mode): string {
  return "mode " + mode;
}
function takesSmall(value: Small): string {
  return "small " + value;
}
function takesPoint(point: Point): string {
  return "point " + point.x;
}

attempt("number given number", () => takesNumber(1));
attempt("number given string", () => takesNumber("one" as any));
attempt("number given undefined", () => takesNumber(undefined as any));
attempt("number given null", () => takesNumber(null as any));

attempt("mode given string literal", () => takesMode("slow"));
attempt("mode given number literal", () => takesMode(1));
attempt("mode given other string", () => takesMode("medium" as any));
attempt("mode given other number", () => takesMode(2 as any));

attempt("small given member", () => takesSmall(3));
attempt("small given other integer", () => takesSmall(7 as any));
attempt("small given string", () => takesSmall("1" as any));

attempt("point given point", () => takesPoint(new Point()));
attempt("point given number", () => takesPoint(5 as any));
attempt("point given object with wrong field", () => takesPoint({ x: "wrong", y: 2 } as any));

class Holder {
  callback: (() => string) | null = null;
  target: Point | null = null;
  missing: Point | undefined = undefined;
}

function callCallback(holder: Holder): string {
  return holder.callback!();
}
function readTarget(holder: Holder): number {
  return holder.target!.x;
}
function readMissing(holder: Holder): number {
  return holder.missing!.x;
}
function storeTarget(holder: Holder): void {
  holder.target!.x = 3;
}

const empty = new Holder();
attempt("null slot called", () => callCallback(empty));
attempt("null slot read", () => readTarget(empty));
attempt("undefined slot read", () => readMissing(empty));
attempt("null slot stored", () => storeTarget(empty));

const filled = new Holder();
filled.callback = () => "called";
filled.target = new Point();
filled.missing = new Point();
attempt("filled slot called", () => callCallback(filled));
attempt("filled slot read", () => readTarget(filled));
attempt("filled undefined slot read", () => readMissing(filled));
