test('Symbol.dispose exists', () => {
  expect(Symbol.dispose).toBeDefined()
  expect(Symbol.dispose).toBeSymbol()
  expect(Symbol.asyncDispose).toBeDefined()
  expect(Symbol.asyncDispose).toBeSymbol()
});

test('SuppressedError works', () => {
  const e = new SuppressedError(new Error("this is error"), new Error('this was suppressed'), 'this is a message');
  expect(e.message).toBe('this is a message');
  expect(() => { throw e.suppressed }).toThrow('this was suppressed');
  expect(() => { throw e }).toThrow('this is error');
})

let disposeOrder = 0;
function useWithAsync() {
  return {
    status: 'none',
    disposeOrder: undefined,
    [Symbol.dispose]() {
      this.status = 'disposed';
      this.disposeOrder = disposeOrder++;
    },
    [Symbol.asyncDispose]() {
      this.status = 'async-disposed';
      this.disposeOrder = disposeOrder++;
    }
  }
}

test('using syntax works', () => {
  const y = useWithAsync();
  {
    using x = y;
    expect(x.status).toBe('none');
  }
  expect(y.status).toBe('disposed');
})
