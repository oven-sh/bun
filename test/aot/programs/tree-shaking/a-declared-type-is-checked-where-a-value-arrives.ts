// Under --aot a value that comes out of untyped code is checked where it meets a declared type. Here it meets the type in a declaration: one that is read afterwards, one that nothing reads, one in a pattern, one in a static field of a class nothing names. The values fit their types, so nothing throws, and what is read has its value.
const untyped: any = JSON.parse('{ "count": 3, "name": "three", "list": [1, 2] }');

const readCount: number = untyped.count;
const unreadCount: number = untyped.count;
const { name: readName }: { name: string } = untyped;
const { name: unreadName }: { name: string } = untyped;
class Unnamed { static held: number[] = untyped.list; }
class Named { static held: number[] = untyped.list; }
const copy: any = untyped;
const unreadCopy: { count: number } = copy;

console.log(readCount + 1, readName.toUpperCase(), Named.held.length);
