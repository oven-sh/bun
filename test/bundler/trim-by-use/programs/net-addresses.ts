// net.BlockList and net.SocketAddress
import net from "node:net";
const list = new net.BlockList();
list.addAddress("10.0.0.1");
list.addRange("10.0.1.1", "10.0.1.9");
list.addSubnet("192.168.0.0", 16);
console.log(
  list.check("10.0.0.1"),
  list.check("10.0.1.5"),
  list.check("192.168.7.7"),
  list.check("8.8.8.8"),
  list.rules.length,
);
const address = new net.SocketAddress({ address: "127.0.0.1", port: 8080 });
console.log(address.address, address.port, address.family, net.SocketAddress.parse("[::1]:443")?.family);
