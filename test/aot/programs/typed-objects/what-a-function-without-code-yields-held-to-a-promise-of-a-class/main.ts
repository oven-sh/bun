// Something untyped that enters a type opens the classes within it, also where the type is a place that takes anything: a Promise of a class. What yields it is a function that the program knows by a declaration alone.
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
