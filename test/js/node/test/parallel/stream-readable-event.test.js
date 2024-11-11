//#FILE: test-stream-readable-event.js
//#SHA1: 8a3da958252097730dcd22e82d325d106d5512a5
//-----------------
'use strict';
const { Readable } = require('stream');

describe('Readable Stream Events', () => {
  test('readable event is triggered when not reading', (done) => {
    const r = new Readable({
      highWaterMark: 3
    });

    r._read = jest.fn();

    r.push(Buffer.from('blerg'));

    setTimeout(() => {
      expect(r._readableState.reading).toBe(false);
      r.on('readable', jest.fn().mockImplementation(() => {
        expect(r._read).not.toHaveBeenCalled();
        done();
      }));
    }, 1);
  });

  test('readable is re-emitted if there\'s already a length while reading', (done) => {
    const r = new Readable({
      highWaterMark: 3
    });

    r._read = jest.fn();

    r.push(Buffer.from('bl'));

    setTimeout(() => {
      expect(r._readableState.reading).toBe(true);
      r.on('readable', jest.fn().mockImplementation(() => {
        expect(r._read).toHaveBeenCalled();
        done();
      }));
    }, 1);
  });

  test('readable event is triggered when stream has not passed highWaterMark but reached EOF', (done) => {
    const r = new Readable({
      highWaterMark: 30
    });

    r._read = jest.fn();

    r.push(Buffer.from('blerg'));
    r.push(null);

    setTimeout(() => {
      expect(r._readableState.reading).toBe(false);
      r.on('readable', jest.fn().mockImplementation(() => {
        expect(r._read).not.toHaveBeenCalled();
        done();
      }));
    }, 1);
  });

  test('Pushing an empty string in non-objectMode should trigger next read()', (done) => {
    const underlyingData = ['', 'x', 'y', '', 'z'];
    const expected = underlyingData.filter((data) => data);
    const result = [];

    const r = new Readable({
      encoding: 'utf8',
    });
    r._read = function() {
      process.nextTick(() => {
        if (!underlyingData.length) {
          this.push(null);
        } else {
          this.push(underlyingData.shift());
        }
      });
    };

    r.on('readable', () => {
      const data = r.read();
      if (data !== null) result.push(data);
    });

    r.on('end', () => {
      expect(result).toEqual(expected);
      done();
    });
  });

  test('removeAllListeners should remove all event listeners', () => {
    const r = new Readable();
    r._read = function() {
      // Actually doing thing here
    };
    r.on('data', function() {});

    r.removeAllListeners();

    expect(r.eventNames().length).toBe(0);
  });
});

//<#END_FILE: test-stream-readable-event.js
