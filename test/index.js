import { Sandbox } from '../src';

import assert from 'assert';

const run = (code) => {
  const sandbox = new Sandbox();
  return sandbox.run(code);
};

describe('sandbox', () => {
  it('should execute javascript', (done) => {
    assert.equal(run('1'), 1);
    assert.equal(run('2'), 2);
    assert.equal(run('new ArrayBuffer(10)'), 3);

    done();
  });
});
