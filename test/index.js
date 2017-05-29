import Sandbox from '../dist';

import assert from 'assert';

const sandbox = new Sandbox();

const runWithTimeout = (code, timeout, callback) => {
  return sandbox.execute(code, timeout, callback);
};

const run = (code, callback) => {
  return runWithTimeout(code, 3000, callback);
};

const TEST_URL = 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt';

describe('sandbox', () => {
  it('should execute httpRequest', (done) => {
    const js = `
httpRequest({uri: '${TEST_URL}'}, (err, res, body) => {
  setResult({value: body});
});
`;

    run(js, (err, result) => {
      assert.equal(result, 'hi there');
      done();
    });
  });

  it('should handle errors from httpRequest', (done) => {
    const js = `
httpRequest({uri: '${TEST_URL}'}, (err, res, body) => {
  throw new Error('yoyo');
});
`;

    run(js, (err, result) => {
      assert.equal(err.message, 'yoyo');
      done();
    });
  });

  it('should run simple script', (done) => {
    const js = `setResult({value: 1337});`;

    run(js, (err, result) => {
      assert.equal(result, 1337);
      done();
    });
  });

  it('should execute setTimeout', (done) => {
    const js = `
setTimeout(() => {
  setResult({value: 1});
}, 1);
`;

    run(js, (err, result) => {
      assert.equal(result, 1);
      done();
    });
  });

  it('should execute setTimeout multiple times', (done) => {
    const js = `
setTimeout(() => {
  setTimeout(() => {
    setTimeout(() => {
      setResult({value: 1});
    }, 1);
  }, 1);
}, 1);
`;

    run(js, (err, result) => {
      assert.equal(result, 1);
      done();
    });
  });

  it('should execute setTimeout multiple times with clearTimeout', (done) => {
    const js = `
let value = 1;

const id = setTimeout(() => {
  value = 2;
}, 1);

clearTimeout(id);

setTimeout(() => {
  setResult({value});
}, 5);
`;
    run(js, (err, result) => {
      assert.equal(result, 1);
      done();
    });
  });

  it('should clearTimeout multiple times', (done) => {
    const js = `
let value = 1;

const id = setTimeout(() => {
  value = 2;
}, 10);

clearTimeout(id);
clearTimeout(id);

setTimeout(() => {
  setResult({value});
}, 15);
`;
    run(js, (err, result) => {
      assert.equal(result, 1);
      done();
    });
  });

  it('should setTimeout with setResult', (done) => {
    const js = `
let value = 1;

const id = setTimeout(() => {
  value = 2;
}, 10);

setTimeout(() => {
  setResult({value});
}, 15);
`;
    run(js, (err, result) => {
      assert.equal(result, 2);
      done();
    });
  });

  it('should timeout when locked up in js', (done) => {
    const js = `while (true) {}`;

    runWithTimeout(js, 30, (err, result) => {
      assert.equal(err.isTimeout, true);
      done();
    });
  });

  it('should timeout when idling in the run loop', (done) => {
    const js = `setTimeout(() => {}, 10000)`;

    runWithTimeout(js, 30, (err, result) => {
      assert.equal(err.isTimeout, true);
      done();
    });
  });

  it('should throw errors from top level script', (done) => {
    const js = `throw new Error('yoyo')`;

    run(js, (err, result) => {
      assert.equal(err.message, 'yoyo');
      done();
    });
  });

  it('should throw errors from setTimeout callbacks', (done) => {
    const js = `
setTimeout(() => {
  throw new Error('yoyo');
}, 1);
`;

    run(js, (err, result) => {
      assert.equal(err.message, 'yoyo');
      done();
    });
  });
});
