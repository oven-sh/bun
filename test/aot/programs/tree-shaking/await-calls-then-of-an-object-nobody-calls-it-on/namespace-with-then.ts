function answer() { return "delivered by a namespace"; }
export function then(resolve: (value: string) => void) { resolve(answer()); }
