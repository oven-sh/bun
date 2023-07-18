import { AsyncLocalStorage } from "async_hooks";

const storage = new AsyncLocalStorage();
setTimeout(() => {
  console.log("b", storage.getStore());
  setTimeout(() => {
    console.log("c", storage.getStore());
  });
}, 100);

storage.enterWith({ a: 1 });

console.log("a", storage.getStore());
