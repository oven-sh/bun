// require()d by mock-module.test.ts after it registers this node: name with mock.module().
// @ts-expect-error not a real builtin
import value from "node:mocked_by_mock_module_test";

export default value;
