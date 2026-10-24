// One object with function properties is used as two record types that each declare some of its properties. It stays one object.
function row(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + String(f()));
  } catch (e) {
    console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e)));
  }
}
function hide(v: unknown): any {
  return v;
}
interface Clickable { label: string; style: { bold: boolean }; onClick: () => string }
interface Hoverable { label: string; style: { bold: boolean }; onHover: () => string }
function click(c: Clickable): string {
  c.label += "!";
  return c.onClick() + c.style.bold;
}
function hover(h: Hoverable): string {
  h.label += "?";
  return h.onHover() + h.style.bold;
}
const madeClickable: Clickable = { label: "c", style: { bold: true }, onClick: () => "clicked" };
const madeHoverable: Hoverable = { label: "h", style: { bold: false }, onHover: () => "hovered" };
row("typed code only", () => click(madeClickable) + hover(madeHoverable));
row("untyped object with functions", () => {
  const props: any = hide(Object.assign({}, { label: "p", style: { bold: true }, onClick: () => "c", onHover: () => "h" })); return click(props) + " " + hover(props) + " " + props.label;
});
