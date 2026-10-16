export function Early(props: { title: string }) {
  const words = [props.title, props.title.toUpperCase()];
  return <p>{words.join(" ")}</p>;
}
