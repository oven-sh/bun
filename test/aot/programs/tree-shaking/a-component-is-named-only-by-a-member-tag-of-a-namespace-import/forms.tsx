/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";

export function Input(props: { name: string }) {
  return <input name={props.name} />;
}

export function Select(props: { name: string }) {
  return <select name={props.name} />;
}
