import Sandbox from '../dist/server/sandbox';
import fs from 'fs';
import path from 'path';

import assert from 'assert';

const sandbox = new Sandbox();

const runWithTimeout = (code, timeout) => {
  return sandbox.execute({code, timeout});
};

const run = (code) => {
  return runWithTimeout(code, 5000);
};

const REQUIRE = path.join(__dirname, 'test-functions.js');

const TEST_URL = 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt';

describe('sandbox', () => {
  after(() => {
    sandbox.shutdown();
  });

  it('HTTP should execute simple httpRequest', async () => {
    const js = `
httpRequest({uri: '${TEST_URL}'}, (err, res, body) => {
  setResult({value: body});
});
`;

    const {value} = await run(js);

    assert.equal(value, 'hi there');
  });

  it('HTTP should handle errors from httpRequest', async () => {
    const js = `
httpRequest({uri: '${TEST_URL}'}, (err, res, body) => {
  throw new Error('yoyo');
});
`;

    const {error} = await run(js);

    assert.equal(error.message, 'yoyo');
  });

  it('should execute httpRequest within a timeout and async function', async () => {
    const js = `
setTimeout(() => {
  httpRequest({uri: '${TEST_URL}'}, (err, res, body) => {
    (async () => {
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, 1);
      });

      setResult({value: body});
    })();
  });
}, 1);
`;

    const {value} = await run(js);

    assert.equal(value, 'hi there');
  });

  it('should handle promises', async () => {
    const js = `
new Promise((resolve) => {
  setTimeout(() => {
    setResult({value: 1});
    resolve();
  }, 20);
});
`;

    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should handle async functions', async () => {
    const js = `
(async () => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 20);
  });

  setResult({value: 1});
})();
`;

    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should handle multiple async functions', async () => {
    const js = `
(async () => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 20);
  });

  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 20);
  });

  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, 20);
  });

  setResult({value: 1});
})();
`;

    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should handle multiple async functions nested within timeouts', async () => {
    const js = `
setTimeout(() => {
  (async () => {
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 20);
    });

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 20);
    });

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 20);
    });

    setResult({value: 12});
  })();
}, 1);
`;

    const {value} = await run(js);

    assert.equal(value, 12);
  });

  it('should collect garbage', async () => {
    const js = `
let objects = []

for (let i = 0; i < 100000; ++i) {
  objects.push(JSON.stringify({test: 1, value: 'two'}));
}

objects = [];

setResult({value: 1});
`;

    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should handle syntax errors', async () => {
    const js = `}`;

    const {error} = await run(js);

    assert.ok(error && error.stack.indexOf('SyntaxError') >= 0);
  });

  it('should capture logs', async () => {
    const js = `console.log('hi'); console.error('there'); console.log('yo'); setResult();`;

    const { output } = await runWithTimeout(js, 30);

    assert.deepStrictEqual(output.map(o => o.message), ['hi', 'there', 'yo']);
  });

  it('should run simple script', async () => {
    const js = `setResult({value: 1337});`;

    const {value} = await run(js);

    assert.equal(value, 1337);
  });

  it('should execute setTimeout', async () => {
    const js = `
setTimeout(() => {
  setResult({value: 1});
}, 1);
`;

    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should execute setTimeout multiple times', async () => {
    const js = `
setTimeout(() => {
  setTimeout(() => {
    setTimeout(() => {
      setResult({value: 1});
    }, 1);
  }, 1);
}, 1);
`;

    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should execute setTimeout multiple times with clearTimeout', async () => {
    const js = `
let value = 1;

const id = setTimeout(() => {
  value = 2;
}, 1000);

clearTimeout(id);

setTimeout(() => {
  setResult({value});
}, 5);
`;

    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should clearTimeout multiple times', async () => {
    const js = `
let value = 1;

const id = setTimeout(() => {
  value = 2;
}, 1000);

clearTimeout(id);
clearTimeout(id);

setTimeout(() => {
  setResult({value});
}, 15);
`;
    const {value} = await run(js);

    assert.equal(value, 1);
  });

  it('should setTimeout with setResult', async () => {
    const js = `
let value = 1;

const id = setTimeout(() => {
  value = 2;
}, 10);

setTimeout(() => {
  setResult({value});
}, 15);
`;

    const {value} = await run(js);

    assert.equal(value, 2);
  });

  it('should timeout when locked up in js', async () => {
    const js = `while (true) {}`;

    const {error} = await runWithTimeout(js, 30);

    assert.equal(error.isTimeout, true);
  });

  it('should timeout when idling in the run loop', async () => {
    const js = `setTimeout(() => {}, 10000)`;

    const {error} = await runWithTimeout(js, 30);

    assert.equal(error.isTimeout, true);
  });

  it('should timeout many times', async () => {
    const js = `while (true) {}`;

    let count = 20;

    const operations = [];

    for (let i = count; i > 0; --i) {
      operations.push(runWithTimeout(js, 30));
    }

    const results = await Promise.all(operations);

    for (const {error} of results) {
      assert.equal(error.isTimeout, true);
    }

    assert.equal(results.length, 20);
  });

  it('should throw errors from top level script', async () => {
    const js = `throw new Error('yoyo')`;

    const {error} = await run(js);

    assert.equal(error.message, 'yoyo');
  });

  it('should throw errors from setTimeout callbacks', async () => {
    const js = `
setTimeout(() => {
  throw new Error('yoyo');
}, 1);
`;

    const {error} = await run(js);

    assert.equal(error.message, 'yoyo');
  });

  it('should not crash when calling native functions with invalid arguments', async () => {
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
        invoke(() => _dispatchSync()),
        invoke(() => _dispatchSync(null)),
        invoke(() => _dispatchSync('setResult', null)),
        invoke(() => _dispatchSync('test')),
        invoke(() => _dispatchSync(() => {}, () => {})),
        invoke(() => _dispatchSync(new Promise(() => {}))),
        invoke(() => _dispatchAsync()),
        invoke(() => _dispatchAsync(null)),
        invoke(() => _dispatchAsync('test')),
        invoke(() => _httpRequest(8)),
        invoke(() => _httpRequest('test', 7)),
        invoke(() => _log()),
        invoke(() => _error())
      ]});
`;

    const {value, error} = await run(js);

    assert.equal(value.length, 18);
  });

  it('should handle stress', async () => {
    const iterations = 500;

    let count = 0;
    const operations = [];

    for (let i = 0; i < iterations; ++i) {
      const js = `
setTimeout(() => {
  setResult({value: ${i}});
}, 1);
`;

      operations.push(run(js));
    }

    const results = await Promise.all(operations);

    for (let i = 0; i < results.length; ++i) {
      assert.equal(results[i].value, i);
    }
  });

  it('should handle queued stress', async () => {
    const iterations = 500;

    let count = 0;

    const operations = [];

    return new Promise((resolve) => {
      for (let i = 0; i < iterations; ++i) {
        const js = `
  setTimeout(() => {
    setResult({value: ${i}});
  }, 1);
  `;

        setImmediate(() => {
          run(js).then(({error, value}) => {
            count++;

            assert.equal(value, i);

            if (count === iterations) {
              resolve();
            }
          });
        });
      }
    });
  });

  it('should handle recursive stress', (done) => {
    const iterations = 500;

    const executeNext = (i) => {
      const js = `
setResult({value: ${i}});
`;

      run(js).then(({error, value}) => {
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

//   it('should handle template scripts', async () => {
//     const template = `
// global.testValue = 1;
// `;

//     const sandbox = new Sandbox({template});

//     const code = `
// setTimeout(() => {
//   setResult({value: ++global.testValue});
// }, 1);
// `;

//     const {value} = await sandbox.execute({code, timeout: 3000});

//     assert.equal(value, 2);

//     sandbox.shutdown();
//   });

  // it('should handle syntax errors in template scripts', async () => {
  //   const template = `{`;

  //   const sandbox = new Sandbox({template});

  //   const code = `setResult({value: 1});`;

  //   const {error} = await sandbox.execute({code, timeout: 3000});

  //   assert.equal(error.message, 'error initializing sandbox. Uncaught SyntaxError: Unexpected end of input');

  //   sandbox.shutdown();
  // });

//   it('should handle errors when crossing between nodejs and sandbox', async () => {
//     const template = '';

//     const sandbox = new Sandbox({template});

//     // must use the raw _setTimeout which doesn't wrap in try/catch. Assume everything in the sandbox
//     // can be overwritten or called manually. This test exercises the TryCatch in OnTimer from C++.
//     const code = `_setTimeout(() => { throw new Error('hi'); }, 1);`;

//     const {error} = await sandbox.execute({code, timeout: 3000});

//     assert.equal(error.message, 'Uncaught Error: hi');

//     sandbox.shutdown();
//   });

//   it('should allow crossing between nodejs and sandbox with custom sync functions', async () => {
//     const sandbox = new Sandbox({require: REQUIRE});

//     const code = `
// setTimeout(() => {
//   setResult({value: addNumbers(1, 2)});
// }, 1);
// `;

//     for (let count = 0; count < 20; ++count) {
//       const {value} = await sandbox.execute({code, timeout: 3000});

//       assert.equal(value, 3);
//     }

//     sandbox.shutdown();
//   });

//   it('should allow crossing between nodejs and sandbox with custom blocking functions', async () => {
//     const sandbox = new Sandbox({require: REQUIRE});

//     const code = `
// setTimeout(() => {
//   setResult({value: addNumbersBlocking(1, 2)});
// }, 1);
// `;

//     for (let count = 0; count < 20; ++count) {
//       const {value} = await sandbox.execute({code, timeout: 3000});

//       assert.equal(value, 3);
//     }

//     sandbox.shutdown();
//   });

//   it('should allow random crossing between nodejs and sandbox with custom sync functions', async () => {
//     const sandbox = new Sandbox({require: REQUIRE});

//     const code = `
// const randomTimeout = () => Math.floor(Math.random() * 5) + 1;

// for (let i = 0; i < 5000; ++i) {
//   setTimeout(() => {
//     setResult({value: addNumbers(1, 2)});
//   }, randomTimeout());
// }
// `;

//     const {value} = await sandbox.execute({code, timeout: 3000});

//     assert.equal(value, 3);

//     sandbox.shutdown();
//   });

//   it('should allow crossing between nodejs and sandbox with custom async functions', async () => {
//     const sandbox = new Sandbox({require: REQUIRE});

//     const code = `
// setTimeout(() => {
//   addNumbersAsync(1, 2, (err, value) => {
//     setResult({value});
//   });
// }, 1);
// `;

//     for (let count = 0; count < 20; ++count) {
//       const {value} = await sandbox.execute({code, timeout: 3000});

//       assert.equal(value, 3);
//     }

//     sandbox.shutdown();
//   });

//   it('should handle errors when crossing between nodejs and sandbox with custom functions', async () => {
//     const template = '';

//     const sandbox = new Sandbox({template, require: REQUIRE});

//     // hack the _try method to directly invoke the function. This would only be possible if someone stomped
//     // on the global functions inside the sandbox. We have to assume everything can be stomped on. This
//     // test exercises the TryCatch on the OnEndNodeInvocation from C++
//     const code = `
// global._try = (fn) => fn();

// setTimeout(() => {
//   addNumbersAsync(1, 2, (err, value) => {
//     throw new Error('uh oh: ' + value);
//   });
// }, 20);
// `;

//     const {error} = await sandbox.execute({code, timeout: 3000});

//     assert.equal(error.message, 'Uncaught Error: uh oh: 3');

//     sandbox.shutdown();
//   });
});
