// Calls of a value of which the text lets one function be expected, in functions that no loop of the text calls by name; now and then the value is something else.
class Router {
  #handle(request) { return "handled " + request; }
  #other = (request) => "field " + request;
  route(request) { return this.#handle(request); }
  viaField(request) { return this.#other(request); }
  replace(f) { this.#other = f; }
}
var Held = class { constructor(x) { this.x = x; } };
var make = (x) => new Held(x);
let callback = (x) => "first " + x;
const callIt = (x) => callback(x);
const holder = { method(x) { return "method " + x + (this === holder); } };
const callMethod = (object, x) => object.method(x);
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const router = new Router();
console.log(router.route(1), router.viaField(2), make(3).x, callIt(4), callMethod(holder, 5));
router.replace(function (request) { return "replaced " + request + (this === router); });
console.log(router.viaField(6));
router.replace(Math.abs);
console.log(router.viaField(-7));
router.replace(router.route.bind(router));
console.log(router.viaField(8));
router.replace(class { });
console.log(attempt(() => router.viaField(9)));
for (const f of [undefined, null, 1, "text", {}, Symbol.iterator]) {
  router.replace(f);
  console.log(attempt(() => router.viaField(10)));
}
console.log(attempt(() => Router.prototype.route.call({}, 11)));
callback = (x) => "second " + x;
console.log(callIt(12));
callback = parseInt;
console.log(callIt("13px"));
callback = undefined;
console.log(attempt(() => callIt(14)));
console.log(callMethod({ method: (x) => "arrow " + x }, 15), callMethod({ method: holder.method }, 16), attempt(() => callMethod({}, 17)), attempt(() => callMethod(null, 18)), callMethod({ method: String }, 19));
Held = class { constructor(x) { this.x = -x; } };
console.log(make(20).x);
Held = function (x) { this.x = "function " + x; };
console.log(make(21).x);
Held = () => 0;
console.log(attempt(() => make(22)));
