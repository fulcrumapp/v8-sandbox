import { Sandbox } from '../lib';

import assert from 'assert';

const run = (code, callback) => {
  const sandbox = new Sandbox();
  return sandbox.run(code, callback);
};

describe('sandbox', () => {
  it('should execute javascript', (done) => {
    const js = `
httpRequest(JSON.stringify({url: ''}), (err, res, body) => {
  // setTimeout(() => {
  //   setResult(1337);
  // }, 1000);
});
`;

    run(js, (err, result) => {
      assert.equal(result, 1337);
      setTimeout(done, 20);
    });
  });
});
