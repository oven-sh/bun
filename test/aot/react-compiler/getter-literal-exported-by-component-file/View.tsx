import { keep, take, type Lazy } from "./state";
export const shared = { get value() { return 40; }, n: 2 };
export function View(props: { title: string }) {
  keep(shared);
  return <p>{props.title + take(shared)}</p>;
}
