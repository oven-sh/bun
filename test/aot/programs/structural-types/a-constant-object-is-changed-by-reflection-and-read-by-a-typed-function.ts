const settings = { port: 80, host: "local", open: false } as const;
function portOf(): 80 {
  return settings.port;
}
console.log(portOf(), settings.host, settings.open);
Reflect.set(settings, "port", 81.5);
Reflect.set(settings, "host", 5);
Reflect.set(settings, "open", "yes");
console.log(portOf(), portOf() === 80, portOf() + 1, settings.host, typeof settings.host, settings.open ? "open" : "closed");
Object.defineProperty(settings, "port", { get: () => "a getter", enumerable: true, configurable: true });
console.log(portOf(), typeof portOf());
Reflect.deleteProperty(settings, "port");
console.log(portOf(), portOf() === undefined, Object.keys(settings).join());
