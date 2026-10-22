// A plain object that has the members of a class arrives inside a Promise, alone and in an array, from a function that the program knows by a declaration alone and that stands in for a method or a field. It is read through the class type as in plain Bun.
import "./setup.js";
declare const functionWithoutCode: (kind: string) => (...args: any[]) => any;
class ByMethod { field: string = "made" }
class ByField { field: string = "made" }
class InAList { field: string = "made" }
class Service {
  async promise(): Promise<ByMethod> { return new ByMethod() }
  async list(): Promise<InAList[]> { return [new InAList()] }
}
const standIn: Service = { promise: functionWithoutCode("a method"), list: functionWithoutCode("a list") };
for (const service of [new Service(), standIn]) console.log((await service.promise()).field, (await service.list())[0].field);
interface Makers { make: () => Promise<ByField> }
const makers: Makers = { make: functionWithoutCode("a field") };
console.log((await makers.make()).field, new ByField().field);
