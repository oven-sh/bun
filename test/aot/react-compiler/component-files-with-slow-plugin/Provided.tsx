export function Provided(props: { title: string }) {
  const words = [props.title, props.title.slice(0, 3)];
  return <i>{words.join(" ")}</i>;
}
