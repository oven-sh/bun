// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { devTest, minimalFramework, Step } from '../dev-server-harness';

devTest('live bindings with `var`', {
  framework: minimalFramework,
  files: {
    'state.ts': `
      export var value = 0;
      export function increment() {
        value++;
      }
    `,
    'routes/index.ts': `
      import { value, increment } from '../state';
      export default function(req, meta) {
        increment();
        return new Response('State: ' + value);
      }
    `,
  },
  steps: [
    Step.fetch('/').expect('State: 1'),
    Step.fetch('/').expect('State: 2'),
    Step.fetch('/').expect('State: 3'),
    Step.patch('routes/index.ts', {
      find: 'State',
      replace: 'Value',
    }),
    Step.fetch('/').expect('Value: 4'),
    Step.fetch('/').expect('Value: 5'),
    Step.write('state.ts', `
      export var value = 0;
      export function increment() {
        value--;
      }
    `),
    Step.fetch('/').expect('Value: -1'),
    Step.fetch('/').expect('Value: -2'),
  ],
});