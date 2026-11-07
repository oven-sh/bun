// Without an annotation a parameter has the type of its default: a caller passes a string where `= undefined` stands.
export function useLabel(prefix, suffix = "!") {
  const read = () => prefix + suffix;
  return <u>{read()}</u>;
}
