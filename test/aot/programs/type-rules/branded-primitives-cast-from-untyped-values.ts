type Name = string & { readonly __brand: "Name" };
type UserId = number & { readonly __brand: "UserId" };
type Flag = boolean & { readonly __brand: "Flag" };
type Big = bigint & { readonly __brand: "Big" };
type Loose = string & {};
type Slug = `${string}-${string}` & { readonly __brand: "Slug" };

function greet(name: Name): string {
  return "hi " + name;
}
function show(id: UserId): string {
  return "#" + (id + 1);
}
function flip(flag: Flag): boolean {
  return !flag;
}
function double(big: Big): bigint {
  return big * 2n;
}
function loose(text: Loose): number {
  return text.length;
}
function slug(text: Slug): string {
  return text.toUpperCase();
}
function either(value: Name | UserId): string {
  return typeof value === "string" ? "name " + value : "id " + value;
}
function maybe(name: Name | undefined): string {
  return name === undefined ? "nobody" : greet(name);
}

const body: any = JSON.parse('{"name":"ada","id":7,"flag":true,"slug":"a-b"}');
console.log(greet(body.name as Name));
console.log(show(body.id as UserId));
console.log(flip(body.flag as Flag));
console.log(loose(body.name as Loose));
console.log(slug(body.slug as Slug));
console.log(either(body.name as Name | UserId), either(body.id as Name | UserId));
console.log(maybe(body.name as Name | undefined), maybe(body.missing as Name | undefined));

const raw: unknown = "bob";
console.log(greet(raw as Name));
const count: unknown = 41;
console.log(show(count as UserId));
const large: unknown = 21n;
console.log(String(double(large as Big)));

const held = body.name as Name;
console.log(typeof held, held.length, greet(held));
const names: Name[] = [body.name as Name, raw as Name];
console.log(names.map(greet).join(", "));
const record: { name: Name; id: UserId } = { name: body.name as Name, id: body.id as UserId };
console.log(greet(record.name), show(record.id));

function brand(value: unknown): Name {
  return value as Name;
}
console.log(greet(brand("eve")));

const typed = JSON.parse('{"name":"kay"}') as { name: string };
console.log(greet(typed.name as Name));
