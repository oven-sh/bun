import { Queue, remember, collect, one, state, either } from "./legacy/empty-literals.ts";
const queue = new Queue();
console.log(queue.add(1), queue.add(2), queue.last, JSON.stringify(queue.items));
console.log(remember(1), remember(2), JSON.stringify(collect(1)), JSON.stringify(collect(2, [1])), JSON.stringify(one(3)));
console.log(JSON.stringify(state(4)), JSON.stringify(either(5, true)), JSON.stringify(either(6, false)));
