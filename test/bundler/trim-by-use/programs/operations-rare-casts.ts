interface System {
  read(path: string): string;
  args: string[];
}
interface Host {
  read(path: string): string;
  onError: (message: string) => void;
}
const system: System = { read: path => "read " + path, args: ["x"] };
function use(host: Host) {
  host.onError(host.read("a"));
}
function withSystem(given: System) {
  const host: Host = given as any;
  host.onError = message => console.log("error", message);
  use(host);
}
withSystem(system);
console.log(Object.keys(system).join(), system.args.length);
