// A conversion that throws inside Bun.escapeHTML leaves the built string as it was before that append.
function fragile(throwOnCall: number): any {
  let calls = 0;
  return {
    toString() {
      if (++calls === throwOnCall) throw new RangeError("conversion " + calls);
      return "<" + calls + ">";
    },
  };
}
function appendStatements(value: any): string {
  let html = "";
  try {
    for (let round = 1; round <= 5; round++) {
      html += "[" + round + "]";
      html += Bun.escapeHTML(value);
    }
  } catch (e) {
    console.log("caught", (e as Error).message, html);
  }
  return html;
}
function appendInOneStatement(value: any): string {
  let html = "start";
  try {
    for (let round = 1; round <= 5; round++) html += "<p>" + round + Bun.escapeHTML(value) + "</p>";
  } catch (e) {
    console.log("caught", (e as Error).message, html);
  }
  return html;
}
function appendWide(value: any): string {
  let html = "日本";
  try {
    for (let round = 1; round <= 5; round++) {
      html += "&" + round;
      html += Bun.escapeHTML(value);
    }
  } catch (e) {
    console.log("caught", (e as Error).message, html);
  }
  return html + "|after";
}
function template(value: any): string {
  try {
    return `<a>${Bun.escapeHTML(value)}</a>`;
  } catch (e) {
    return "template " + (e as Error).message;
  }
}
console.log(appendStatements(fragile(3)));
console.log(appendInOneStatement(fragile(3)));
console.log(appendWide(fragile(3)));
console.log(appendStatements(fragile(1)));
console.log(appendStatements(fragile(9)));
console.log(template(fragile(1)));
console.log(template(fragile(2)));
