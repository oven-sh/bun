// --minify-syntax joins adjacent pieces of template and string text before the compiler sees them.
type Props = { a: number; text: string };

export function TwoTemplates({ a, text }: Props) {
  "use memo";
  return [`a${a}` + `b${text}`];
}

export function ConstantInHead({ a }: Props) {
  "use memo";
  return [`a${"b"}c${a}`];
}

export function ConstantsInTail({ a }: Props) {
  "use memo";
  return [`${a}a${"b"}c${1}d${null}e`];
}

export function TemplatePlusStrings({ a }: Props) {
  "use memo";
  return [`a${a}b` + "c" + "d", "a" + `b${a}`];
}

export function Strings({ a }: Props) {
  "use memo";
  return ["a" + "b" + "c", a];
}

// A piece that is not ASCII is stored in another form, and is not joined.
export function NotAscii({ a, text }: Props) {
  "use memo";
  return [`a${a}` + `é${text}`, `日${"b"}c${a}`, `a${"日"}c${a}`, `${a}a` + "é" + "b", "a" + "😀" + `b${a}`];
}

export function Keys({ a }: Props) {
  "use memo";
  return { ["a" + "b"]: a, element: <p {...{ ["c" + "d"]: a }} /> };
}
