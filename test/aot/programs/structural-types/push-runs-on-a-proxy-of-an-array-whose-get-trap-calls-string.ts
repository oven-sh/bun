const log: string[] = [];
const proxy = new Proxy([10, 20, 30], {
  get(t, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(t, key, receiver);
  },
});
proxy.push(40);
console.log(log.join());
