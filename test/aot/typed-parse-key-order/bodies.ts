// `bodies <declared | sorted> <rounds>` parses one order from a text whose keys are in declaration order or in alphabetical order. No code of the program makes an object of these types.
interface Address { street: string; city: string; zip: string; country: string }
interface Order { id: number; customer: string; address: Address; total: number; items: { sku: string; quantity: number; price: number }[]; paid: boolean }
const declared = '{"id":7,"customer":"Ada","address":{"street":"1 Main St","city":"Springfield","zip":"12345","country":"US"},"total":99.5,"items":[{"sku":"a1","quantity":2,"price":10.25},{"sku":"b2","quantity":1,"price":79}],"paid":true}';
const sorted = '{"address":{"city":"Springfield","country":"US","street":"1 Main St","zip":"12345"},"customer":"Ada","id":7,"items":[{"price":10.25,"quantity":2,"sku":"a1"},{"price":79,"quantity":1,"sku":"b2"}],"paid":true,"total":99.5}';
function parse(text: string): Order { return JSON.parse(text) as Order; }
const text = process.argv[2] === "sorted" ? sorted : declared;
const rounds = Number(process.argv[3] ?? 1);
let sum = 0;
for (let i = 0; i < rounds; i++) { const order = parse(text); sum += order.total + order.items.length + order.address.zip.length; }
console.log(sum);
