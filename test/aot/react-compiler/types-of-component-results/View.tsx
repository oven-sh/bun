import { currentRoot, describe, describeChoice, finish, isCurrent, items, keep, keptChoice, topOf, type Choice, type Item, type Root } from "./state";

function Badge(props: { root: Root; label: string }) {
  return <b>{props.label + ":" + props.root.id + ":" + topOf(props.root)}</b>;
}
function Row(props: { item: Item; root: Root; onPick: (choice: Choice) => string }) {
  const choice: Choice = { root: props.root, item: props.item };
  return <i>{props.onPick(choice)}</i>;
}
export function View(props: { title: string }) {
  const root = currentRoot();
  root.owner.use();
  const picked: string[] = [];
  const onPick = (choice: Choice) => {
    picked.push(describeChoice(choice) + " " + isCurrent(choice));
    finish(choice);
    keep(choice);
    return describeChoice(choice) + " " + (keptChoice() === choice);
  };
  const context = { root, first: items[0]!, all: items };
  return (
    <p>
      {props.title}
      <Badge root={root} label={describe(context.root)} />
      {context.all.map(item => <Row item={item} root={context.root} onPick={onPick} />)}
      {picked.join("|")}
    </p>
  );
}
