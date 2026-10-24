const holder: { port: 80 } = { port: 80 };
const wide: { port: number } = holder;

function portOf(): 80 {
  return holder.port;
}

console.log(holder.port, holder.port === 80, portOf() + 1);
wide.port = 8080.5;
console.log(holder.port);
console.log(holder.port === 80);
console.log(holder.port + 1);
console.log(portOf());
console.log(portOf() === 80 ? "still 80" : "changed");
console.log(holder.port | 0);
