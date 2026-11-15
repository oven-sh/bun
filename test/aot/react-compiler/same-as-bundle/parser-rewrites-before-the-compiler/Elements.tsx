import { next } from "./counter";

const _lower = (props: { a: number }) => "lower " + props.a;
const $dollar = (props: { a: number }) => "dollar " + props.a;

function Item(props: { a: number; children?: unknown }) {
  return <li>{props.a}</li>;
}

export function Elements({ a }: { a: number }) {
  const props = { a };
  return (
    <>
      <Item a={a} />
      <Item {...props} key="k" />
      <Item key="k" {...props} />
      <ul title={"t" + "u"}>
        text &amp; more
        {next()}
        <Item a={next()}>{a}</Item>
      </ul>
    </>
  );
}

export function OddTags({ a }: { a: number }) {
  return (
    <p>
      <_lower a={a} />
      <$dollar a={a} />
    </p>
  );
}
