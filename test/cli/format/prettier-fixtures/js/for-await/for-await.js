async function foo() {
  for await (num of asyncIterable) {
    console.log(num);
  }
  for await (num of asyncGeneratorFunc()) {
    console.log(num);
  }
}

(async () => {
  for await (num of asyncIterable) {
    console.log(num);
  }
  for await (const x of delegate_yield()) {
    x;
  }
})();
