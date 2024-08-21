//#FILE: test-zlib-truncated.js
//#SHA1: 79f9bcf3c52b3d0736ebe457652d579a856d1f7b
//-----------------
'use strict';
// Tests zlib streams with truncated compressed input

const zlib = require('zlib');

const inputString = 'ΩΩLorem ipsum dolor sit amet, consectetur adipiscing eli' +
                    't. Morbi faucibus, purus at gravida dictum, libero arcu ' +
                    'convallis lacus, in commodo libero metus eu nisi. Nullam' +
                    ' commodo, neque nec porta placerat, nisi est fermentum a' +
                    'ugue, vitae gravida tellus sapien sit amet tellus. Aenea' +
                    'n non diam orci. Proin quis elit turpis. Suspendisse non' +
                    ' diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu' +
                    'm arcu mi, sodales non suscipit id, ultrices ut massa. S' +
                    'ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ';

const errMessage = /unexpected end of file/;

[
  { comp: 'gzip', decomp: 'gunzip', decompSync: 'gunzipSync' },
  { comp: 'gzip', decomp: 'unzip', decompSync: 'unzipSync' },
  { comp: 'deflate', decomp: 'inflate', decompSync: 'inflateSync' },
  { comp: 'deflateRaw', decomp: 'inflateRaw', decompSync: 'inflateRawSync' },
].forEach(function(methods) {
  test(`Test ${methods.comp} compression and ${methods.decomp} decompression`, async () => {
    const compressed = await new Promise((resolve, reject) => {
      zlib[methods.comp](inputString, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const truncated = compressed.slice(0, compressed.length / 2);
    const toUTF8 = (buffer) => buffer.toString('utf-8');

    // sync sanity
    const decompressed = zlib[methods.decompSync](compressed);
    expect(toUTF8(decompressed)).toBe(inputString);

    // async sanity
    await new Promise((resolve, reject) => {
      zlib[methods.decomp](compressed, (err, result) => {
        if (err) reject(err);
        else {
          expect(toUTF8(result)).toBe(inputString);
          resolve();
        }
      });
    });

    // Sync truncated input test
    expect(() => {
      zlib[methods.decompSync](truncated);
    }).toThrow(expect.objectContaining({message: expect.stringMatching(errMessage)}));

    // Async truncated input test
    await expect(new Promise((resolve, reject) => {
      zlib[methods.decomp](truncated, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    })).rejects.toThrow(expect.objectContaining({message: expect.stringMatching(errMessage)}));

    const syncFlushOpt = { finishFlush: zlib.constants.Z_SYNC_FLUSH };

    // Sync truncated input test, finishFlush = Z_SYNC_FLUSH
    const result = toUTF8(zlib[methods.decompSync](truncated, syncFlushOpt));
    expect(result).toBe(inputString.slice(0, result.length));

    // Async truncated input test, finishFlush = Z_SYNC_FLUSH
    await new Promise((resolve, reject) => {
      zlib[methods.decomp](truncated, syncFlushOpt, (err, decompressed) => {
        if (err) reject(err);
        else {
          const result = toUTF8(decompressed);
          expect(result).toBe(inputString.slice(0, result.length));
          resolve();
        }
      });
    });
  });
});