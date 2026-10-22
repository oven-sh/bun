// Nothing that runs names these constants, classes and enums of two files, so they are left out. The type checker still needs all of them: for contextual types, inferred generics, discriminated unions, mapped and conditional types, overloads picked by a constant's type, a class's private and protected members, an enum as the type of a parameter, and a `unique symbol`.
import type { Remote, RemoteShape } from "./types";
import { remoteDefaults, RemoteKind } from "./types";

const shapes = [{ kind: "circle" as const, radius: 1 }, { kind: "square" as const, side: 2 }];
type Shape = (typeof shapes)[number];
const handlers = { circle: (shape: { radius: number }) => shape.radius, square: (shape: { side: number }) => shape.side };
type Handlers = typeof handlers;
type Results = { [K in keyof Handlers]: ReturnType<Handlers[K]> };
const marker: unique symbol = Symbol("marker");
type Marked = { [marker]: string };
class Account { private balance = 0; protected owner = "nobody"; public id = 1; static count = 0; }
type PublicOfAccount = keyof Account;
enum Step { One, Two, Three }
const tuple = [1, "two", true] as const;
type Second = (typeof tuple)[1];
const pick = <T extends object, K extends keyof T>(object: T, key: K): T[K] => object[key];
type Picked = ReturnType<typeof pick<{ a: number }, "a">>;
const nestedDefaults = { server: { port: 80, tls: { enabled: false } } };
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return shape.radius * 3;
    case "square": return shape.side * shape.side;
  }
}
function name(step: Step): string {
  switch (step) {
    case 0: return "one";
    case 1: return "two";
    default: return "three";
  }
}
const results: Results = { circle: 1, square: 2 };
const key: PublicOfAccount = "id";
const second: Second = "two";
const picked: Picked = 5;
const partial: DeepPartial<typeof nestedDefaults> = { server: { tls: {} } };
const remote: Remote = { url: "u", retries: 2 };
const remoteShape: RemoteShape = "round";
const fromDefaults: typeof remoteDefaults = { url: "v", retries: 3 };
const kind: `${RemoteKind}` = "fast";

console.log(area({ kind: "circle", radius: 2 }), area({ kind: "square", side: 3 }), name(1 as Step), results.square, key, second, picked + 1);
console.log(JSON.stringify(partial), remote.retries + 1, remoteShape, fromDefaults.url, kind);
