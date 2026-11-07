export function Late(props: { title: string }) {
  const words = [props.title, String(props.title.length)];
  return <b>{words.join(" ")}</b>;
}
