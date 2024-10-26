//#FILE: test-stream-writable-final-throw.js
//#SHA1: db2aed4b456940c82162944d986811edab449867
//-----------------
'use strict';

const { Duplex } = require('stream');

test('Duplex stream _final method throws error', (done) => {
  class Foo extends Duplex {
    _final(callback) {
      throw new Error('fhqwhgads');
    }

    _read() {}
  }

  const foo = new Foo();
  
  foo._write = jest.fn((chunk, encoding, cb) => {
    cb();
  });

  foo.on('error', (err) => {
    expect(err).toEqual(expect.objectContaining({
      message: 'fhqwhgads'
    }));
    expect(foo._write).toHaveBeenCalledTimes(1);
    done();
  });

  foo.end('test');
});

//<#END_FILE: test-stream-writable-final-throw.js
