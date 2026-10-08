// #5678
const refreshTokenPayload = {
    type: 'refreshToken',
    sub: this._id,
    role: this.role,
  	// prettier-ignore
    exp: now + (60 * 60 * 24 * 90), // (90 days)
  };

export default {
  // prettier-ignore
  protagonist: "  0\r\n" +
               "0 00\r\n" +
               "00000\r\n" +
               "0 0\r\n" +
               "0 0",

  // prettier-ignore
  wall: "00000\r\n" +
        "00000\r\n" +
        "00000\r\n" +
        "00000\r\n" +
        "00000",

  // prettier-ignore
  cheese: "0\r\n" +
          " 0\r\n" +
          "000\r\n" +
          "00 0\r\n" +
          "00000",

  // prettier-ignore
  enemy: "0   0\r\n" +
         "00 00\r\n" +
         "00000\r\n" +
         "0 0 0\r\n" +
         "00000",

  // prettier-ignore
  home: "00000\r\n" +
        "0   0\r\n" +
        "0   0\r\n" +
        "0   0\r\n" +
        "00000",

  // prettier-ignore
  dog: "00 00\r\n" +
       "00000\r\n" +
       "0   0\r\n" +
       "0 0 0\r\n" +
       " 000 "
}
