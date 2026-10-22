// One symbol imported under two names is one field; two symbols with one description are two fields.
// IR= 0 readAlias ElemGet
// IR= 1 readAlias : number = PropGet v[0-9]+ name=UniqueSymbol "[^"]*shared"
import * as all from "./symbols";
import { kShared, kSecond, type Tagged } from "./symbols";
import { readAlias, Holder } from "./user";

class Both implements Tagged {
  [kShared]: number = 1;
  [kSecond]: number = 2;
}
const both = new Both();
console.log(both[kShared], both[kSecond], readAlias(both), both[all.kShared], Reflect.ownKeys(both).length);
const holder = new Holder();
console.log(holder[kShared], readAlias(holder), readAlias({ [kShared]: 9 }), Object.getOwnPropertySymbols(holder)[0] === kShared);
