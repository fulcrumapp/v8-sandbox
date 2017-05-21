import { Sandbox } from './src';

import assert from 'assert';

const run = (code, callback) => {
  const sandbox = new Sandbox();
  return sandbox.run(code, callback);
};

const js = `
httpRequest({url: ''}, (err, res, body) => {
  setResult(body);
// setTimeout(() => {
//   setResult(1337);
// }, 1000);
});
`;

run(js, (err, result) => {
  assert.equal(result, 1337);
  setTimeout(done, 20);
});
