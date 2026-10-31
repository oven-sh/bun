const started = performance.now();
console.log(typeof started, performance.now() >= started, performance.timeOrigin > 0);
console.log(typeof Performance, performance instanceof Performance, Object.hasOwn(performance, "now"));
console.log(typeof Performance.prototype.now.call(performance));
