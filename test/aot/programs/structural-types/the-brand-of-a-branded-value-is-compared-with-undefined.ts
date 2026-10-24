type UserId = string & { readonly __brand: "UserId" };
type Meters = number & { readonly unit: "m" };

function isUserId(text: string): text is UserId {
  return text.length > 0;
}
function isMeters(n: number): n is Meters {
  return n >= 0;
}

const text: string = "u7";
const n: number = 2.5;
if (isUserId(text)) {
  console.log(text.__brand);
  console.log(text.__brand === undefined);
  console.log(text.__brand === "UserId");
  console.log(typeof text.__brand);
  console.log(typeof text.__brand === "string");
  console.log(text.__brand ?? "no brand");
  console.log(text.length, text + "!");
}
if (isMeters(n)) {
  console.log(n.unit);
  console.log(n.unit === undefined);
  console.log(n.unit === "m");
  console.log(typeof n.unit === "string");
  console.log(n.unit ?? "no unit");
  console.log(n * 2);
}
