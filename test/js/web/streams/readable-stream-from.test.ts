import { test, expect } from "bun:test";
import { bunEnv } from "harness";

// Based on https://github.com/web-platform-tests/wpt/blob/48fe2a8e29d44b7764aea192e84c8eb931f36ed6/streams/readable-streams/from.any.js

const iterableFactories = [
  ['an array of values', () => {
    return ['a', 'b'];
  }],

  ['an array of promises', () => {
    return [
      Promise.resolve('a'),
      Promise.resolve('b')
    ];
  }],

  ['an array iterator', () => {
    return ['a', 'b'][Symbol.iterator]();
  }],

  ['a string', () => {
    // This iterates over the code points of the string.
    return 'ab';
  }],

  ['a Set', () => {
    return new Set(['a', 'b']);
  }],

  ['a Set iterator', () => {
    return new Set(['a', 'b'])[Symbol.iterator]();
  }],

  ['a sync generator', () => {
    function* syncGenerator() {
      yield 'a';
      yield 'b';
    }

    return syncGenerator();
  }],

  ['an async generator', () => {
    async function* asyncGenerator() {
      yield 'a';
      yield 'b';
    }

    return asyncGenerator();
  }],

  ['a sync iterable of values', () => {
    const chunks = ['a', 'b'];
    const iterator = {
      next() {
        return {
          done: chunks.length === 0,
          value: chunks.shift()
        };
      }
    };
    const iterable = {
      [Symbol.iterator]: () => iterator
    };
    return iterable;
  }],

  ['a sync iterable of promises', () => {
    const chunks = ['a', 'b'];
    const iterator = {
      next() {
        return chunks.length === 0 ? { done: true } : {
          done: false,
          value: Promise.resolve(chunks.shift())
        };
      }
    };
    const iterable = {
      [Symbol.iterator]: () => iterator
    };
    return iterable;
  }],

  ['an async iterable', () => {
    const chunks = ['a', 'b'];
    const asyncIterator = {
      next() {
        return Promise.resolve({
          done: chunks.length === 0,
          value: chunks.shift()
        })
      }
    };
    const asyncIterable = {
      [Symbol.asyncIterator]: () => asyncIterator
    };
    return asyncIterable;
  }],

  ['a ReadableStream', () => {
    return new ReadableStream({
      start(c) {
        c.enqueue('a');
        c.enqueue('b');
        c.close();
      }
    });
  }],

  ['a ReadableStream async iterator', () => {
    return new ReadableStream({
      start(c) {
        c.enqueue('a');
        c.enqueue('b');
        c.close();
      }
    })[Symbol.asyncIterator]();
  }]
];

for (const [label, factory] of iterableFactories) {
  test(`ReadableStream.from accepts ${label}`, async () => {
    const iterable = factory();
    const rs = ReadableStream.from(iterable);
    expect(rs.constructor).toBe(ReadableStream);

    const reader = rs.getReader();
    expect(await reader.read()).toEqual({ value: 'a', done: false });
    expect(await reader.read()).toEqual({ value: 'b', done: false });
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    await reader.closed;
  });
}

const badIterables = [
  ['null', null],
  ['undefined', undefined],
  ['0', 0],
  ['NaN', NaN],
  ['true', true],
  ['{}', {}],
  ['Object.create(null)', Object.create(null)],
  ['a function', () => 42],
  ['a symbol', Symbol()],
  ['an object with a non-callable @@iterator method', {
    [Symbol.iterator]: 42
  }],
  ['an object with a non-callable @@asyncIterator method', {
    [Symbol.asyncIterator]: 42
  }],
  ['an object with an @@iterator method returning a non-object', {
    [Symbol.iterator]: () => 42
  }],
  ['an object with an @@asyncIterator method returning a non-object', {
    [Symbol.asyncIterator]: () => 42
  }],
];

for (const [label, iterable] of badIterables) {
  test(`ReadableStream.from throws on invalid iterables; specifically ${label}`, () => {
    expect(() => ReadableStream.from(iterable)).toThrow(TypeError);
  });
}

test('ReadableStream.from re-throws errors from calling the @@iterator method', () => {
  const theError = new Error('a unique string');
  const iterable = {
    [Symbol.iterator]() {
      throw theError;
    }
  };

  expect(() => ReadableStream.from(iterable)).toThrow(theError);
});

test('ReadableStream.from re-throws errors from calling the @@asyncIterator method', () => {
  const theError = new Error('a unique string');
  const iterable = {
    [Symbol.asyncIterator]() {
      throw theError;
    }
  };

  expect(() => ReadableStream.from(iterable)).toThrow(theError);
});

test('ReadableStream.from ignores @@iterator if @@asyncIterator exists', () => {
  const theError = new Error('a unique string');
  let iteratorCalled = false;
  const iterable = {
    [Symbol.iterator]() {
      iteratorCalled = true;
      return { next: () => ({ done: true }) };
    },
    [Symbol.asyncIterator]() {
      throw theError;
    }
  };

  expect(() => ReadableStream.from(iterable)).toThrow(theError);
  expect(iteratorCalled).toBe(false);
});

test('ReadableStream.from ignores a null @@asyncIterator', () => {
  const theError = new Error('a unique string');
  const iterable = {
    [Symbol.asyncIterator]: null,
    [Symbol.iterator]() {
      throw theError
    }
  };

  expect(() => ReadableStream.from(iterable)).toThrow(theError);
});

test('ReadableStream.from accepts an empty iterable', async () => {
  const iterable = {
    async next() {
      return { value: undefined, done: true };
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  const read = await reader.read();
  expect(read).toEqual({ value: undefined, done: true });

  await reader.closed;
});

test('ReadableStream.from: stream errors when next() rejects', async () => {
  const theError = new Error('a unique string');

  const iterable = {
    async next() {
      throw theError;
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.read()).rejects.toBe(theError);
  await expect(reader.closed).rejects.toBe(theError);
});

test('ReadableStream.from: stream errors when next() throws synchronously', async () => {
  const theError = new Error('a unique string');

  const iterable = {
    next() {
      throw theError;
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.read()).rejects.toBe(theError);
  await expect(reader.closed).rejects.toBe(theError);
});

test('ReadableStream.from: stream errors when next() returns a non-object', async () => {
  const iterable = {
    next() {
      return 42; // not a promise or an iterator result
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.read()).rejects.toThrow(TypeError);
  await expect(reader.closed).rejects.toThrow(TypeError);
});

test('ReadableStream.from: stream errors when next() fulfills with a non-object', async () => {
  const iterable = {
    next() {
      return Promise.resolve(42); // not an iterator result
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.read()).rejects.toThrow(TypeError);
  await expect(reader.closed).rejects.toThrow(TypeError);
});

test('ReadableStream.from: calls next() after first read()', async () => {
  let nextCalls = 0;
  let nextArgs: any;
  const iterable = {
    async next(...args: any[]) {
      nextCalls += 1;
      nextArgs = args;
      return { value: 'a', done: false };
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  // Flush async events
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(nextCalls).toBe(0);

  const read = await reader.read();
  expect(read).toEqual({ value: 'a', done: false });
  expect(nextCalls).toBe(1);
  expect(nextArgs).toEqual([]);
});

test('ReadableStream.from: cancelling the returned stream calls and awaits return()', async () => {
  const theError = new Error('a unique string');

  let returnCalls = 0;
  let returnArgs: any;
  let resolveReturn: any;
  const iterable = {
    next() {
      throw new Error('next() should not be called');
    },
    throw() {
      throw new Error('throw() should not be called');
    },
    async return(...args: any[]) {
      returnCalls += 1;
      returnArgs = args;
      await new Promise(r => resolveReturn = r);
      return { done: true };
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();
  expect(returnCalls).toBe(0);

  let cancelResolved = false;
  const cancelPromise = reader.cancel(theError).then(() => {
    cancelResolved = true;
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  expect(returnCalls).toBe(1);
  expect(returnArgs).toEqual([theError]);
  expect(cancelResolved).toBe(false);

  resolveReturn();
  await Promise.all([
    cancelPromise,
    reader.closed
  ]);
});

test('ReadableStream.from: return() is not called when iterator completes normally', async () => {
  let nextCalls = 0;
  let returnCalls = 0;

  const iterable = {
    async next() {
      nextCalls += 1;
      return { value: undefined, done: true };
    },
    throw() {
      throw new Error('throw() should not be called');
    },
    async return() {
      returnCalls += 1;
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  const read = await reader.read();
  expect(read).toEqual({ value: undefined, done: true });
  expect(nextCalls).toBe(1);

  await reader.closed;
  expect(returnCalls).toBe(0);
});

test('ReadableStream.from: cancel() resolves when return() method is missing', async () => {
  const theError = new Error('a unique string');

  const iterable = {
    next() {
      throw new Error('next() should not be called');
    },
    throw() {
      throw new Error('throw() should not be called');
    },
    // no return method
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await Promise.all([
    reader.cancel(theError),
    reader.closed
  ]);
});

test('ReadableStream.from: cancel() rejects when return() is not a method', async () => {
  const theError = new Error('a unique string');

  const iterable = {
    next() {
      throw new Error('next() should not be called');
    },
    throw() {
      throw new Error('throw() should not be called');
    },
    return: 42,
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.cancel(theError)).rejects.toThrow(TypeError);
  await reader.closed;
});

test('ReadableStream.from: cancel() rejects when return() rejects', async () => {
  const cancelReason = new Error('cancel reason');
  const rejectError = new Error('reject error');

  const iterable = {
    next() {
      throw new Error('next() should not be called');
    },
    throw() {
      throw new Error('throw() should not be called');
    },
    async return() {
      throw rejectError;
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.cancel(cancelReason)).rejects.toBe(rejectError);
  await reader.closed;
});

test('ReadableStream.from: cancel() rejects when return() throws synchronously', async () => {
  const cancelReason = new Error('cancel reason');
  const rejectError = new Error('reject error');

  const iterable = {
    next() {
      throw new Error('next() should not be called');
    },
    throw() {
      throw new Error('throw() should not be called');
    },
    return() {
      throw rejectError;
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.cancel(cancelReason)).rejects.toBe(rejectError);
  await reader.closed;
});

test('ReadableStream.from: cancel() rejects when return() fulfills with a non-object', async () => {
  const theError = new Error('a unique string');

  const iterable = {
    next() {
      throw new Error('next() should not be called');
    },
    throw() {
      throw new Error('throw() should not be called');
    },
    async return() {
      return 42;
    },
    [Symbol.asyncIterator]: function() { return this; }
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();

  await expect(reader.cancel(theError)).rejects.toThrow(TypeError);
  await reader.closed;
});

test('ReadableStream.from(array), push() to array while reading', async () => {
  let array = ['a', 'b'];

  const rs = ReadableStream.from(array);
  const reader = rs.getReader();

  const read1 = await reader.read();
  expect(read1).toEqual({ value: 'a', done: false });
  const read2 = await reader.read();
  expect(read2).toEqual({ value: 'b', done: false });

  array.push('c');

  const read3 = await reader.read();
  expect(read3).toEqual({ value: 'c', done: false });
  const read4 = await reader.read();
  expect(read4).toEqual({ value: undefined, done: true });

  await reader.closed;
});

// Basic smoke tests for backward compatibility
test("ReadableStream.from basic functionality", () => {
  expect(typeof ReadableStream.from).toBe("function");
  expect(ReadableStream.from.length).toBe(1);
});

test("ReadableStream.from() integration with Response", async () => {
  const stream = ReadableStream.from(["hello", " ", "world"]);
  const response = new Response(stream);
  const text = await response.text();
  expect(text).toBe("hello world");
});