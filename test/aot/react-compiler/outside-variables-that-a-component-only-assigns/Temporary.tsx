import { Button } from "./buttons";
let t0 = 0;
export const read = () => t0;
export function View(p: { n: number }) {
  const save = () => {
    t0 = p.n;
  };
  return <Button onClick={save}>{p.n}</Button>;
}
