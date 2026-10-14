// Objects made by `JSON.parse` are used through declared interface types, with missing, extra and wrongly typed properties.
interface Address { city: string; zip?: string }
interface Person { id: number; nick: string; active: boolean; address: Address; tags: string[]; boss?: Person | null; score?: number }
const source = '{"nick":"ann","id":1,"extra":[1,2],"active":true,"address":{"zip":"123","city":"Oslo"},"tags":["a","b"],"boss":null}'
const raw = JSON.parse(source)
const parsed = raw as Person
console.log(parsed === raw, parsed.address === raw.address, parsed.tags === raw.tags, Object.keys(raw).join(), Object.keys(parsed).join())
parsed.score = 5; parsed.id++
console.log(JSON.stringify(parsed), raw.id, "score" in raw)
const tricky = JSON.parse('{"__proto__":{"id":9},"id":3,"nick":"t","active":false,"address":{"city":"c"},"tags":[]}') as Person
console.log(Object.keys(tricky).join(), tricky.id, Object.getPrototypeOf(tricky) === Object.prototype)
const rawList = JSON.parse("[" + source + "]"), first = rawList[0]
const list = rawList as Person[]
console.log(list === rawList, list[0] === first, rawList[0] === list[0])
const { address, extra, ...others } = list[0] as Person & { extra: number[] }
console.log(address.city, extra.length, JSON.stringify(others), JSON.stringify({ ...list[0], id: 50 }))
