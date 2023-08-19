export default function dedent(str: string, ...args: any[]) {
  if (Array.isArray(str)) {
    let result = "";
    let numArgs = args.length;
    for (let i = 0; i < str.length; i++) {
      result += dedent(str[i]);
      if (i < numArgs) result += args[i];
    }
    str = result;
  }
  let indent = Infinity;
  const lines = str
    .replace(/^\s*\n/, "")
    .trimEnd()
    .split("\n");
  for (const line of lines) {
    let thisIndent = 0;
    for (const char of line) {
      if (char === " ") thisIndent++;
      else break;
    }
    if (thisIndent < indent) indent = thisIndent;
  }
  return lines.map(line => line.slice(indent)).join("\n");
}
