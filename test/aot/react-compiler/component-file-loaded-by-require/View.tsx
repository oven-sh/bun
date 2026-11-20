import { describe, type Item } from "./state";

export function View(props: { item: Item }) {
  return <p>{describe(props.item)}</p>;
}
