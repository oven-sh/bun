import {
    describe,
    it,
    Mock,
    expect
  } from "bun:test";
  
  describe("test jest mock", () => {
    it("calling mock", () => {
      const val = Mock
      console.log(val)
      expect(val).toBeTruthy()
    })
  })