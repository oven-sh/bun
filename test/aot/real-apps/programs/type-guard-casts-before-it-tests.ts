const matcher = Symbol.for("matcher");
interface Matcher {
  [matcher](): { match: (value: unknown) => boolean };
}
const isMatcher = (x: unknown): x is Matcher => {
  const pattern = x as Matcher;
  return pattern && !!pattern[matcher];
};
const made: Matcher = { [matcher]: () => ({ match: () => true }) };
console.log(isMatcher("A"), isMatcher(1), isMatcher(made));
