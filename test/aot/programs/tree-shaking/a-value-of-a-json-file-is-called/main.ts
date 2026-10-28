import data from "./data.json";
try {
  (data as any).version();
} catch (error: any) {
  console.log(error.constructor.name, error.message);
}
try {
  (data as any).nested.port();
} catch (error: any) {
  console.log(error.constructor.name, error.message);
}
try {
  (data as any).version`x`;
} catch (error: any) {
  console.log(error.constructor.name);
}
try {
  new (data as any).version();
} catch (error: any) {
  console.log(error.constructor.name);
}
console.log(data.version);
