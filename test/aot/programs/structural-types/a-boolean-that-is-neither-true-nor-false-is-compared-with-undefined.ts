const flags: boolean[] = [true, false];
function text(flag: boolean): string {
  if (flag === true) return "true";
  if (flag === false) return "false";
  return "neither, undefined: " + (flag === undefined);
}
console.log(text(flags[2]));
