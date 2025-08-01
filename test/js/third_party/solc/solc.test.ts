import solc from "solc";

describe("solc", () => {
  it("can compile a simple program", () => {
    const input = {
      language: "Solidity",
      sources: {
        "test.sol": {
          content: "contract C { function f() public { } }",
        },
      },
      settings: {
        outputSelection: {
          "*": {
            "*": ["*"],
          },
        },
      },
    };
    expect(() => solc.compile(JSON.stringify(input))).not.toThrow();
  });
});
