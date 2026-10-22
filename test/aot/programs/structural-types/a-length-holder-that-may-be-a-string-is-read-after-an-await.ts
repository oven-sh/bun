type HasLength = { length: number };
async function afterAnAwait(item: HasLength): Promise<number> {
  await null;
  return item.length;
}
console.log(await afterAnAwait({ length: 4 }), await afterAnAwait("hello"), await afterAnAwait([1]));
export {};
