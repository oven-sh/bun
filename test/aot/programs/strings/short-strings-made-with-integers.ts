// Strings concatenated from constants, integers and other strings that are not used as keys: every kind of integer, parts that are empty, long, ropes or 16-bit, parts that are undefined behind their type, and what is done with the result.
const lines: string[] = [];
type User = { email: string; name: string; tag: string };
function user(i: number, domain: string): User {
  return { email: `user${i}@${domain}`, name: "Name " + i, tag: i + "" };
}
function digest(text: string): number {
  let sum = text.length;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000003;
  return sum;
}
function users(count: number, domains: string[]): string {
  let sum = 0;
  let found = 0;
  for (let i = 0; i < count; i++) {
    const u = user(i * 7 - 20, domains[i % domains.length]!);
    sum = (sum + digest(u.email) + digest(u.name) + digest(u.tag)) % 1000003;
    if (u.email.indexOf("@") > 4 && u.name.toLowerCase().startsWith("name ") && u.email.endsWith(domains[i % domains.length]!)) found++;
    if (u.name === "Name " + (i * 7 - 20)) found++;
  }
  return sum + ":" + found;
}
function edges(): string {
  const out: string[] = [];
  const integers: number[] = [0, -0, 1, -1, 9, 10, 99, 100, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 9007199254740991, -9007199254740991];
  for (let i = 0; i < integers.length; i++) {
    const n = integers[i]!;
    const small = n | 0;
    const unsigned = n >>> 0;
    out.push("<" + small + ">", "[" + unsigned + "]", small + "|" + unsigned, `${small}`, `${small}${unsigned}`, "n" + Math.floor(n / 3));
  }
  return out.join(" ");
}
function withStrings(texts: string[]): string {
  let sum = 0;
  let last = "";
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!;
    const one = text + i;
    const two = i + text;
    const three = text + ":" + i + ":" + text;
    sum = (sum + digest(one) * 3 + digest(two) * 5 + digest(three) * 7) % 1000003;
    last = three.length < 40 ? three : last;
  }
  return sum + ":" + last;
}
function grows(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) text = text + i + ",";
  let other = "";
  for (let i = 0; i < count; i++) other = i + ";" + other;
  return digest(text) + ":" + digest(other) + ":" + text.length + ":" + other.length;
}
function chosen(i: number, flag: boolean): string {
  const label = flag ? "even " + i : "odd " + i + "!";
  return label.length > 7 ? label.slice(2) : label;
}
function inside(i: number): string {
  return "a" + ("b" + i) + ("c" + (i + 1) + "d") + i;
}
function looselyTyped(values: number[], texts: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) out.push("v" + (i | 0) + texts[i]! + "w", "n" + values[i]!);
  return out.join();
}

const domains = ["example.com", "", "x.io", "café.fr", "Δ.gr", "long-".repeat(20) + "name.org"];
const ropes: string[] = ["", "a", "plain", "café", "Δelta", "x".repeat(70)];
for (let i = 0; i < 5; i++) ropes.push(ropes[i + 1]! + "-" + ropes[(i * 3) % 6]!);
lines.push(users(400, domains), edges(), withStrings(ropes), grows(300));
let picked = "";
for (let i = 0; i < 24; i += 5) picked += chosen(i * 97, i % 2 === 0) + "," + inside(i) + ";";
lines.push(picked, looselyTyped([1.5, NaN, undefined as unknown as number], ["s", undefined as unknown as string, null as unknown as string]));
console.log(lines.join("\n"));
