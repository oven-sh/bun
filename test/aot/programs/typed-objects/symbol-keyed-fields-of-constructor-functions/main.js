// Records made by typed constructor functions have fields keyed by symbols; untyped code sees ordinary own properties.
// IR+ shape [0-9]+ Record "Response"
// IR= 0 finish GetByVal
// IR= 1 finish : number = GetById .*:kState"
// IR= 0 Response PutByVal
import { dispatch } from "./typed.ts";
let total = 0;
function handler(response) { response.statusCode = 201; response.end(); }
for (let i = 0; i < 2000; i++) total += dispatch(handler, "/json");
console.log(total);
let seen;
dispatch(response => { seen = response; }, "/x");
console.log(Reflect.ownKeys(seen).map(String).join());
console.log(JSON.stringify(seen), Object.getOwnPropertySymbols(seen).map(symbol => String(seen[symbol])).join());
seen.setState(7);
console.log(Object.getOwnPropertySymbols(seen).map(symbol => String(seen[symbol])).join(), seen.listenerCount());
