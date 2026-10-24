// Functions that are named only inside JSX: as the value of an attribute, as a child in braces, in a spread attribute and in a spread child.
/* @jsxRuntime classic */
/* @jsx h */
export {};
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

function h(tag: any, props: any, ...children: any[]): string {
  const parts: string[] = [];
  for (const key in props) parts.push(key + "=" + (typeof props[key] === "function" ? props[key]() : props[key]));
  for (const child of children.flat()) parts.push(typeof child === "function" ? child() : child);
  return tag + "(" + parts.join(" ") + ")";
}

function inAttribute() {
  return "attribute";
}
function asChild() {
  return "child";
}
function inSpread() {
  return "spread";
}
function inSpreadChild() {
  return "spread child";
}

console.log(<a render={inAttribute} {...{ other: inSpread }}>{asChild}{...[inSpreadChild]}</a>);
