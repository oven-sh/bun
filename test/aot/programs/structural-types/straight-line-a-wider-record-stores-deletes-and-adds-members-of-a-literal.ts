const point = { x: 1, y: 0.5, name: "p" };
const wider: Record<string, number | string | null> = point;
console.log(point.x + point.y);
wider.x = "text";
console.log(typeof point.x);
console.log(point.x + 1);
console.log(point.x * 2);
wider["y"] = null;
console.log(typeof point.y);
console.log(point.y + 1);
wider.name = 7;
console.log(typeof point.name);
console.log(point.name + "!");
console.log(point.name.length);
wider.extra = 1;
console.log(Object.keys(point).join());
delete wider.x;
console.log(typeof point.x);
console.log(point.x + 1);
console.log("x" in point);
console.log(Object.keys(point).join());
console.log(JSON.stringify(point));
wider.x = 5;
console.log(point.x + 1);
console.log(Object.keys(point).join());
try {
  console.log(point.name.toUpperCase());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
