import data from "./data.json";
console.log(
  data.version,
  data["version"],
  data[`version`],
  data!.version,
  (data as any).version,
  (<any>data).version,
  data?.version,
  data.nested?.port,
  data?.["nested"]["port"],
);
console.log(
  typeof data.version,
  typeof data,
  data.version.length,
  data.version.toUpperCase(),
  `${data.nested.port}`,
  -data.nested.port,
  !data.nested.deep.on,
);
console.log(
  (data as any).missing,
  (data as any).toString === Object.prototype.toString,
  (data as any).constructor === Object,
  (data as any).__proto__ === Object.prototype,
  (data as any).nested.missing,
);
const {
  version,
  nested: { port },
} = data;
console.log(version, port);
