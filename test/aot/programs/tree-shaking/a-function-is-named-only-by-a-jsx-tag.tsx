// The tag <Greeting /> is the only reference to the function Greeting, and <Name /> inside it the only one to Name.
/* @jsxRuntime classic */
/* @jsx h */
export {};
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

function h(tag: any, props: any, ...children: any[]): any {
  return typeof tag === "function" ? tag({ ...props, children }) : "<" + tag + ">" + children.join("") + "</" + tag + ">";
}

function Name(props: { value: string }) {
  return <i>{props.value.toUpperCase()}</i>;
}

function Greeting(props: { name: string }) {
  return <b>hello <Name value={props.name} /></b>;
}

console.log(<Greeting name="world" />);
