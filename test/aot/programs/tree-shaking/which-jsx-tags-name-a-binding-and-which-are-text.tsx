// <box /> is the text "box" although a function box exists. <_Box />, <$Box /> and <ui.box /> name bindings although they do not start with a capital.
/* @jsxRuntime classic */
/* @jsx h */
export {};
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

function h(tag: any, props: any): any {
  return typeof tag === "function" ? tag(props) : "text " + tag;
}

function box() {
  return "the function box";
}
function _Box() {
  return "the function _Box";
}
function $Box() {
  return "the function $Box";
}
function inner() {
  return "the function inner";
}
const ui = { box: () => inner() };

console.log(<box />);
console.log(<_Box />);
console.log(<$Box />);
console.log(<ui.box />);
