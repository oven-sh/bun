import { Button } from "./buttons";
let $ = 0;
export const read = () => $;
export function View(p: { n: number }) {
  const save = () => {
    $ = p.n;
  };
  return <Button onClick={save}>{p.n}</Button>;
}
