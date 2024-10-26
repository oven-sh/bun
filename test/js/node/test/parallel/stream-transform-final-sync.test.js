//#FILE: test-stream-transform-final-sync.js
//#SHA1: c13500c70ac3cc7f027da1fccd14da83ce010616
//-----------------
'use strict';
const stream = require('stream');

test('Stream Transform final sync', (done) => {
  let state = 0;

  const t = new stream.Transform({
    objectMode: true,
    transform(chunk, _, next) {
      // transformCallback part 1
      expect(++state).toBe(chunk);
      this.push(state);
      // transformCallback part 2
      expect(++state).toBe(chunk + 2);
      process.nextTick(next);
    },
    final(done) {
      state++;
      // finalCallback part 1
      expect(state).toBe(10);
      state++;
      // finalCallback part 2
      expect(state).toBe(11);
      done();
    },
    flush(done) {
      state++;
      // flushCallback part 1
      expect(state).toBe(12);
      process.nextTick(() => {
        state++;
        // flushCallback part 2
        expect(state).toBe(13);
        done();
      });
    }
  });

  // Spy on the transform, final, and flush methods
  jest.spyOn(t, '_transform');
  jest.spyOn(t, '_final');
  jest.spyOn(t, '_flush');

  const finishListener = jest.fn(() => {
    state++;
    // finishListener
    expect(state).toBe(15);
  });

  const endListener = jest.fn(() => {
    state++;
    // endEvent
    expect(state).toBe(16);
    
    // Assertions after all operations are complete
    expect(t._transform).toHaveBeenCalledTimes(3);
    expect(t._final).toHaveBeenCalledTimes(1);
    expect(t._flush).toHaveBeenCalledTimes(1);
    expect(finishListener).toHaveBeenCalledTimes(1);
    expect(endListener).toHaveBeenCalledTimes(1);
    expect(dataListener).toHaveBeenCalledTimes(3);
    expect(endMethodCallback).toHaveBeenCalledTimes(1);

    done();
  });

  const dataListener = jest.fn((d) => {
    // dataListener
    expect(++state).toBe(d + 1);
  });

  t.on('finish', finishListener);
  t.on('end', endListener);
  t.on('data', dataListener);

  const endMethodCallback = jest.fn(() => {
    state++;
    // endMethodCallback
    expect(state).toBe(14);
  });

  t.write(1);
  t.write(4);
  t.end(7, endMethodCallback);
});

//<#END_FILE: test-stream-transform-final-sync.js
