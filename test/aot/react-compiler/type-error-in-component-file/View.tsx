function helper(): number {
  const inAHelper: number = "a helper";
  return inAHelper;
}
function takes(given: symbol) {
  return String(given);
}
export function View(props: { title: string }) {
  const inAComponent: boolean = "a component";
  const lines = [props.title, String(helper()), String(inAComponent), takes("an argument")];
  return <p>{lines.join("\n")}</p>;
}
