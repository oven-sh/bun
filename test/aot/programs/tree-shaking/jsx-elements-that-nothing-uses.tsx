// An element is a call of the factory, and this factory counts its calls. One element is kept in a constant nothing reads, one is a statement of its own, one is exported and imported by nobody, one is used. `bun run` drops the statement alone and counts 6 calls. `bun build --compile` takes an element for something without effects and makes only the two that are used or exported: 4 calls.
/* @jsxRuntime classic */
/* @jsx h */
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

let calls = 0;
const h = (tag: any, props: any, ...children: any[]): any => {
  calls++;
  return typeof tag === "string" ? "<" + tag + ">" + children.join("") + "</" + tag + ">" : tag({ ...props, children });
};
const Arrow = (props: { text: string }) => <i>{props.text}</i>;

const neverUsed = <Arrow text="kept in a constant nothing reads" />;
<Arrow text="a statement of its own" />;
export const exported = <Arrow text="exported by the entry point" />;
const used = <Arrow text="used" />;
console.log(used, calls);
