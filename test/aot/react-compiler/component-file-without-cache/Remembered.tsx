export function Remembered(props: { title: string }) {
  const lines = [props.title, "remembered"];
  return <p>{lines.join(" ")}</p>;
}
