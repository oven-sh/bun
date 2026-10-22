// Nothing that runs names these declarations; types do: typeof a constant, keyof typeof, an indexed access, the type of a class, the members of an enum, a constant with `as const`, `satisfies`. The values that are typed by them are made elsewhere.
const defaults = { port: 80, host: "localhost", tags: ["a"] };
const levels = ["low", "high"] as const;
const table = { a: 1, b: 2 } satisfies Record<string, number>;
class Point { x = 0; y = 0; norm() { return Math.hypot(this.x, this.y); } }
enum Color { Red = "red", Green = "green" }
const handler = (event: { kind: string }) => event.kind.length;
const nested = { inner: { deep: [1, 2, 3] } };

const config: typeof defaults = { port: 8080, host: "example", tags: [] };
const level: (typeof levels)[number] = "high";
const name: keyof typeof table = "b";
const point: Point = { x: 3, y: 4, norm: () => 5 };
const color: `${Color}` = "green";
const other: typeof handler = event => event.kind.length * 2;
const deep: (typeof nested)["inner"]["deep"] = [4];
const constructed: InstanceType<typeof Point> = point;

console.log(config.port + 1, config.host.toUpperCase(), level, name, point.norm(), color, other({ kind: "ab" }), deep[0] + 1, constructed.x);
