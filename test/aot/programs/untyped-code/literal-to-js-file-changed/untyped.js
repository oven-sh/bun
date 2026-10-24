export function alter(target) {
  target.more = { n: 2 };
  target.count = "many";
  return target;
}
