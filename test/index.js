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

  it('should handle syntax errors', (done) => {
    const js = `}`;

    run(js, (err, result) => {
      assert.ok(err && err.stack.indexOf('SyntaxError') >= 0);
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

  it('should not crash when calling native functions with invalid arguments', (done) => {
    const js = `
      function invoke(fn) {
        try {
          return fn();
        } catch (ex) {
          return ex.message;
        }
      }

      setResult({value: [
        invoke(() => _setTimeout()),
        invoke(() => _setTimeout(null)),
        invoke(() => _setTimeout(7, 7)),
        invoke(() => _clearTimeout()),
        invoke(() => _clearTimeout(null)),
        invoke(() => _setResult(null)),
        invoke(() => _setResult(7)),
        invoke(() => _dispatchSync()),
        invoke(() => _dispatchSync(null)),
        invoke(() => _dispatchSync('test')),
        invoke(() => _dispatchAsync()),
        invoke(() => _dispatchAsync(null)),
        invoke(() => _dispatchAsync('test')),
        invoke(() => _httpRequest(8)),
        invoke(() => _httpRequest('test', 7)),
        invoke(() => _log()),
        invoke(() => _error())
      ]});
`;

    run(js, (err, result) => {
      assert.equal(result.length, 17);
      done();
    });
  });

  it('should handle stress', (done) => {
    const iterations = 500;

    let count = 0;

    for (let i = 0; i < iterations; ++i) {
      const js = `
setTimeout(() => {
  setResult({value: ${i}});
}, 1);
`;

      run(js, (err, value) => {
        count++;
        assert.equal(value, i);

        if (count === iterations) {
          done();
        }
      });
    }
  });

  it('should handle queued stress', (done) => {
    const iterations = 500;

    let count = 0;

    for (let i = 0; i < iterations; ++i) {
      const js = `
setTimeout(() => {
  setResult({value: ${i}});
}, 1);
`;

      setImmediate(() => {
        run(js, (err, value) => {
          count++;
          assert.equal(value, i);

          if (count === iterations) {
            done();
          }
        });
      });
    }
  });

  it('should handle recursive stress', function (done) {
    this.timeout(10000000);

    const iterations = 500;

    const executeNext = (i) => {
      const js = `
setResult({value: ${i}});
`;

      run(js, (err, value) => {
        assert.equal(value, i);

        if (i === iterations) {
          done();
        } else {
          setImmediate(() => {
            executeNext(i + 1);
          });
        }
      });
    };

    executeNext(0);
  });
});
