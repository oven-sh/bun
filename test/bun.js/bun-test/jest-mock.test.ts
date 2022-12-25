import {
    describe,
    it,
    expect,
    fn
  } from "bun:test";
  
  describe("test jest mock", () => {
    it("calling mock", () => {
      const val = fn
      console.log(val)
      expect(val).toBeTruthy()
    })
  })