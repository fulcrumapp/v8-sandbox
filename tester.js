const Sandbox = require('./dist/sandbox').default;
// const assert = require('assert');
// const path = require('path');

console.log('SANDBOX', Sandbox);

const sandbox = new Sandbox();

const code = `
const value = dispatchSync('test', [1, 2, 3]);

_debug('yoyoy');
_debug(value == null ? 'NULL' : 'NOT NULL');
_debug(JSON.stringify(value))
_debug('ggggg');

dispatchAsync('testAsync', [1, 2, 3], (err, res) => {
  _debug("inside async callback");
  _debug(JSON.stringify([err, res]));
  setResult({value: res});
  _debug('ENDDBEFORE!!!')
});

_debug('ENDD!!!')
`;

sandbox.execute({code}, (result) => {
  console.log('RESULT', result);
});

console.log('SANDBOX2');