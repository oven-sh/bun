// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { devTest, minimalFramework, Step } from '../dev-server-harness';

devTest('import identifier doesnt get renamed', {
  framework: minimalFramework,
  files: {
    'db.ts': `export const abc = "123";`,
    'routes/index.ts': `
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + '!');
      }
    `,
  },
  steps: [
    Step.fetch('/').expect('Hello, 123, 987!'),
    Step.write('db.ts', `export const abc = "456";`),
    Step.fetch('/').expect('Hello, 123, 987!'),
    Step.patch('routes/index.ts', {
      find: 'Hello',
      replace: 'Bun',
    }),
    Step.fetch('/').expect('Bun, 456, 987!'),
  ],
});
devTest('symbol collision with import identifier', {
  framework: minimalFramework,
  files: {
    'db.ts': `export const abc = "123";`,
    'routes/index.ts': `
      let import_db = 987;
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + ', ' + import_db + '!');
      }
    `,
  },
  steps: [
    Step.fetch('/').expect('Hello, 123, 987!'),
    Step.write('db.ts', `export const abc = "456";`),
    Step.fetch('/').expect('Hello, 123, 987!'),
  ],
});
