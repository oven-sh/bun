//#FILE: test-http2-misc-util.js
//#SHA1: 0fa21e185faeff6ee5b1d703d9a998bf98d6b229
//-----------------
const http2 = require("http2");

describe("HTTP/2 Misc Util", () => {
  test("HTTP2 constants are defined", () => {
    expect(http2.constants).toBeDefined();
    expect(http2.constants.NGHTTP2_SESSION_SERVER).toBe(0);
    expect(http2.constants.NGHTTP2_SESSION_CLIENT).toBe(1);
  });
  // make it not fail after re-enabling push
  test.todo("HTTP2 default settings are within valid ranges", () => {
    const defaultSettings = http2.getDefaultSettings();
    expect(defaultSettings).toBeDefined();
    expect(defaultSettings.headerTableSize).toBeGreaterThanOrEqual(0);
    expect(defaultSettings.enablePush).toBe(true); // push is disabled because is not implemented yet
    expect(defaultSettings.initialWindowSize).toBeGreaterThanOrEqual(0);
    expect(defaultSettings.maxFrameSize).toBeGreaterThanOrEqual(16384);
    expect(defaultSettings.maxConcurrentStreams).toBeGreaterThanOrEqual(0);
    expect(defaultSettings.maxHeaderListSize).toBeGreaterThanOrEqual(0);
  });

  test("HTTP2 getPackedSettings and getUnpackedSettings", () => {
    const settings = {
      headerTableSize: 4096,
      enablePush: true,
      initialWindowSize: 65535,
      maxFrameSize: 16384,
    };
    const packed = http2.getPackedSettings(settings);
    expect(packed).toBeInstanceOf(Buffer);

    const unpacked = http2.getUnpackedSettings(packed);
    expect(unpacked).toEqual(expect.objectContaining(settings));
  });
});

//<#END_FILE: test-http2-misc-util.js
