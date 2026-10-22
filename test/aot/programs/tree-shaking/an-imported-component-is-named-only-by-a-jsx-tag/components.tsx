/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";

function frame(text: string): string {
  return "[" + text + "]";
}

export function Card(props: { children?: any }) {
  return <div>{frame(String(props.children))}</div>;
}

export default function Title(props: { text: string }) {
  return <h1>{props.text}</h1>;
}

export function Unused() {
  return <hr />;
}
