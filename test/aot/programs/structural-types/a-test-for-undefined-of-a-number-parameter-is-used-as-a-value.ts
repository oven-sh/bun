function isMissing(n: number): boolean {
  return n === undefined;
}

function isThere(n: number): boolean {
  return n !== undefined;
}

function isNullish(n: number): boolean {
  return n == null;
}

function hasTheKindUndefined(n: number): boolean {
  return typeof n === "undefined";
}

function isNotANumber(n: number): boolean {
  return typeof n !== "number";
}

function keptInALocal(n: number): boolean {
  const answer = n === undefined;
  return answer;
}

const byAnArrow = (n: number): boolean => n === undefined;

class Checker {
  isMissing(n: number): boolean {
    return n === undefined;
  }
}

function asACondition(n: number): string {
  return n === undefined ? "missing" : "there";
}

const list: number[] = [1, 2, 3];
console.log("=== undefined " + isMissing(list[9]) + " " + isMissing(list[0]));
console.log("!== undefined " + isThere(list[9]) + " " + isThere(list[0]));
console.log("== null " + isNullish(list[9]) + " " + isNullish(list[0]));
console.log("typeof === 'undefined' " + hasTheKindUndefined(list[9]) + " " + hasTheKindUndefined(list[0]));
console.log("typeof !== 'number' " + isNotANumber(list[9]) + " " + isNotANumber(list[0]));
console.log("kept in a local " + keptInALocal(list[9]) + " " + keptInALocal(list[0]));
console.log("by an arrow " + byAnArrow(list[9]) + " " + byAnArrow(list[0]));
console.log("by a method " + new Checker().isMissing(list[9]) + " " + new Checker().isMissing(list[0]));
console.log("as a condition " + asACondition(list[9]) + " " + asACondition(list[0]));

export {};
