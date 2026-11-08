const target = new EventTarget();
let count = 0;
target.addEventListener("ping", () => count++, { once: true });
target.dispatchEvent(new Event("ping"));
target.dispatchEvent(new Event("ping"));
const timer = setTimeout(() => {}, 1000);
clearTimeout(timer);
console.log(count, typeof performance.now(), new DOMException("x", "AbortError").name);
