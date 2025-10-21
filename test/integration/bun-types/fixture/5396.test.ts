import { describe, expect, it, jest, mock, spyOn } from "bun:test";

class AnyDTO {
  anyField: string = "any_value";
}

class AnyClass {
  async anyMethod(): Promise<AnyDTO> {
    return new AnyDTO();
  }
}

const anyObject: AnyClass = {
  anyMethod: jest.fn(),
};

describe("Any describe", () => {
  it("should return any value", async () => {
    spyOn(anyObject, "anyMethod").mockResolvedValue({ anyField: "any_value" });
    const anyValue = await anyObject.anyMethod();

    expect(anyValue).toEqual({ anyField: "any_value" });
  });
});

const mockSomething = mock((): string => "hi");
mockSomething.mockImplementation(() => "hello");
mockSomething.mockReturnValue("hello");
