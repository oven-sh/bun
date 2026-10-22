const flags: boolean[] = [true, false];
function text(flag: boolean): string {
  switch (flag) {
    case true:
      return "true";
    case false:
      return "false";
  }
  return "neither, undefined: " + (flag === undefined);
}
console.log(text(flags[2]));
