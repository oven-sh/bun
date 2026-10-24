// The tag <Counter /> is the only reference to the class Counter. The factory constructs it and calls render().
/* @jsxRuntime classic */
/* @jsx h */
export {};
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

function h(tag: any, props: any, ...children: any[]): any {
  if (typeof tag === "string") return "<" + tag + ">" + children.join("") + "</" + tag + ">";
  return new tag({ ...props, children }).render();
}

class Counter {
  props: { start: number };
  constructor(props: { start: number }) {
    this.props = props;
  }
  next(): number {
    return this.props.start + 1;
  }
  render(): any {
    return <p>{this.next()}</p>;
  }
}

console.log(<Counter start={41} />);
