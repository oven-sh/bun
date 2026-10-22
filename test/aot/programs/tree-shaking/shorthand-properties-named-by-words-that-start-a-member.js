// `{ get, set, async, static }` are four shorthand properties, not the start of an accessor or of an async method. Each is the only reference to a function of that name. Beside them: methods and accessors that are named get, set, async and static.
function get() { return "get"; }
function set() { return "set"; }
function async() { return "async"; }
function static_() { return "static"; }
function await_() { return "await"; }

const shorthand = { get, set, async };
console.log(shorthand.get(), shorthand.set(), shorthand.async());
const last = { async, get };
console.log(last.async(), last.get());
const named = {
  get() { return "a method named get"; },
  set() { return "a method named set"; },
  async() { return "a method named async"; },
  get get() { return "an accessor named get"; },
  async async() { return "an async method named async"; },
  static: static_,
  await: await_,
};
console.log(named.set(), named.get, await named.async(), named.static(), named.await());
class Klass {
  static static() { return "a static method named static"; }
  static get get() { return "a static accessor named get"; }
  static async async() { return "a static async method named async"; }
  get = get;
  set = set;
  static async = async;
}
console.log(Klass.static(), Klass.get, typeof Klass.async, new Klass().get(), new Klass().set());
