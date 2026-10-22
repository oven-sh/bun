/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";
export * as forms from "./forms";

export function Button(props: { label: string }) {
  return <button>{props.label}</button>;
}

export function Link(props: { to: string }) {
  return <a href={props.to} />;
}
