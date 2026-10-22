const counter = {
  count: 1,
  read(): number {
    return this.count;
  },
};
const rebuilt = Object.fromEntries(Object.entries({ read: counter.read }));
console.log("gives " + rebuilt.read());
