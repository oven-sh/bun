// A result of split() that is never made stands beside an array whose first capacity the compiler takes from the length of another array.
let guard = 0;
function filledByLength(line: string): string {
  if (guard > 1e9) return filledByLength(line + "x");
  const cols = line.split(",");
  const out: number[] = [];
  for (let i = 0; i < cols.length; i++) out.push(i * 2);
  return out.join("+") + "|" + cols[0] + "|" + cols[1];
}
function storedByLength(line: string): string {
  if (guard > 1e9) return storedByLength(line + "x");
  const cols = line.split(";");
  const out: string[] = [];
  for (let i = 0; i < cols.length; i++) out[i] = "<" + i + ">";
  return out.join("") + cols.length;
}
function spreadBeside(line: string, more: string[]): string {
  if (guard > 1e9) return spreadBeside(line + "x", more);
  const cols = line.split(",");
  const out = [cols[0], ...more, cols[1]];
  return out.join("/") + cols.length;
}
let out = "";
for (const line of ["", "a", "a,b", "1,2,3,4,5,6,7,8,9", ";;", "x;y,z"]) out += [filledByLength(line), storedByLength(line), spreadBeside(line, ["m", "n"])].join(" # ") + "\n";
guard += out.length > 1e12 ? 1 : 0;
console.log(out);
export {};
