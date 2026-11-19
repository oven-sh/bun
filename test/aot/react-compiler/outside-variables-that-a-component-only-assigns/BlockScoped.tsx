import { Button } from "./buttons";
let count = 0;
export const read = () => count;
export function View(p: { n: number }) {
  let text = "";
  {
    const count = p.n * 2;
    text = "twice " + count;
  }
  const save = () => {
    count = p.n;
  };
  return <Button onClick={save}>{text}</Button>;
}
