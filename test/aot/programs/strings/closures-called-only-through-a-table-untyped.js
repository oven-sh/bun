// Strings: closures called only through a table (the same program without type annotations).
const handlers = new Map;
function register(name, prefix) {
  handlers.set(name, (s) => new RegExp(prefix + "[0-9]+y").test(s));
}
register("a", "aaa");
register("b", "bbb");
function ask(who, s) {
  const f = handlers.get(who);
  return f ? f(s) : false;
}
setTimeout(() => console.log(ask("a", "aaa1y"), ask("b", "aaa1y")), 0);
