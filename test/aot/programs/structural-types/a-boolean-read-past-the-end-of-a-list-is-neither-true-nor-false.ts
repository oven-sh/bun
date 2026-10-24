const flags: boolean[] = [true, false];

function text(flag: boolean): string {
  if (flag === true) return "true";
  if (flag === false) return "false";
  return "neither, undefined: " + (flag === undefined);
}
function other(flag: boolean): string {
  if (flag === true) return "true";
  return "false: " + (flag === false);
}
function kind(flag: boolean): string {
  if (flag) return "truthy";
  return flag === false ? "false" : "falsy and not false";
}

console.log(text(flags[0]), text(flags[1]));
console.log(other(flags[2]));
console.log(kind(flags[2]));
console.log(text(flags[2]));
