interface Account {
  label: string;
  x: number;
  items: number[];
}
class Point {
  label = "ab";
  x = 2.5;
  items = [1, 2];
}
function kinds(account: Account): string {
  return Object.values({ ...account })
    .map(each => typeof each)
    .join();
}
function kindsWithOneMore(account: Account): string {
  return Object.values({ ...account, more: 1 })
    .map(each => typeof each)
    .join();
}
function someAreUndefined(account: Account): boolean {
  return Object.values({ ...account }).some(each => each === undefined);
}
function howManyAreStrings(account: Account): number {
  return Object.values({ ...account }).filter(each => typeof each === "string").length;
}
function noneIsUndefined(account: Account): boolean {
  return Object.values({ ...account }).every(each => each !== undefined);
}
function asStrings(account: Account): string {
  return Object.values({ ...account })
    .map(each => String(each))
    .join();
}
function orAFallback(account: Account): string {
  return Object.values({ ...account })
    .map(each => each ?? "fallback")
    .join();
}
function theRestOfAPattern(account: Account): string {
  const { label, ...rest } = account;
  return (
    label +
    " " +
    Object.values(rest)
      .map(each => typeof each)
      .join()
  );
}
function walked(account: Account): string {
  let found = "";
  for (const each of Object.values({ ...account })) found += typeof each + " ";
  return found;
}
function keptInAConstant(account: Account): string {
  const copy = { ...account };
  return (
    typeof copy.label +
    " " +
    typeof copy.x +
    " " +
    Object.values(copy)
      .map(each => typeof each)
      .join()
  );
}
function ofALiteral(): string {
  return Object.values({ ...{ first: "a", second: 2 } })
    .map(each => typeof each)
    .join();
}
function joined(account: Account): string {
  return Object.values({ ...account }).join();
}
function theFirst(account: Account): string {
  return typeof Object.values({ ...account })[0];
}
function byAssign(account: Account): string {
  return Object.values(Object.assign({}, account))
    .map(each => typeof each)
    .join();
}
function entries(account: Account): string {
  return Object.entries({ ...account })
    .map(([key, value]) => key + " " + typeof value)
    .join();
}
function withoutACopy(account: Account): string {
  return Object.values(account)
    .map(each => typeof each)
    .join();
}
const literal: Account = { label: "cd", x: 1.5, items: [1] };
const instance: Account = new Point();
console.log("kinds: " + kinds(literal) + " | " + kinds(instance));
console.log("kinds with one more member: " + kindsWithOneMore(literal) + " | " + kindsWithOneMore(instance));
console.log("some are undefined: " + someAreUndefined(literal) + " | " + someAreUndefined(instance));
console.log("how many are strings: " + howManyAreStrings(literal) + " | " + howManyAreStrings(instance));
console.log("none is undefined: " + noneIsUndefined(literal) + " | " + noneIsUndefined(instance));
console.log("as strings: " + asStrings(literal) + " | " + asStrings(instance));
console.log("or a fallback: " + orAFallback(literal) + " | " + orAFallback(instance));
console.log("the rest of a pattern: " + theRestOfAPattern(literal) + " | " + theRestOfAPattern(instance));
console.log("walked: " + walked(literal) + " | " + walked(instance));
console.log("a copy kept in a constant: " + keptInAConstant(literal) + " | " + keptInAConstant(instance));
console.log("a copy of a literal: " + ofALiteral());
console.log("joined: " + joined(literal) + " | " + joined(instance));
console.log("the first: " + theFirst(literal) + " | " + theFirst(instance));
console.log("a copy by assign: " + byAssign(literal) + " | " + byAssign(instance));
console.log("entries: " + entries(literal) + " | " + entries(instance));
console.log("without a copy: " + withoutACopy(literal) + " | " + withoutACopy(instance));
