const target = new EventTarget();
const seen: string[] = [];
target.addEventListener("ping", event =>
  seen.push(event.type + ":" + (event as CustomEvent).detail + ":" + event.cancelable),
);
target.dispatchEvent(new CustomEvent("ping", { detail: 7, cancelable: true }));
const message = new MessageEvent("message", { data: { a: 1 }, origin: "here" });
const error = new ErrorEvent("error", { message: "bad", lineno: 3 });
const close = new CloseEvent("close", { code: 1000, reason: "done", wasClean: true });
const plain = new Event("x", { bubbles: true });
plain.preventDefault();
plain.stopPropagation();
console.log(
  seen.join(),
  message.data.a,
  message.origin,
  error.message,
  error.lineno,
  close.code,
  close.reason,
  close.wasClean,
  plain.bubbles,
  plain.defaultPrevented,
  plain instanceof Event,
  typeof plain.timeStamp,
);
console.log(plain, message);
