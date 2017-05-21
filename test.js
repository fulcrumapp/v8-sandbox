import { Sandbox } from './src';

import assert from 'assert';

const run = (code, callback) => {
  const sandbox = new Sandbox();
  return sandbox.run(code, callback);
};

const jsAsync = `
httpRequest({url: ''}, (err, res, body) => {
  setResult(body);
// setTimeout(() => {
//   setResult(1337);
// }, 1000);
});
`;

const js = `
const [err, res, body] = httpRequest({url: ''});
setResult(body);
`;

run(jsAsync, (err, result) => {
  assert.equal(result, 'response data');
  console.log('success!');
});

run(js, (err, result) => {
  assert.equal(result, 'response data');
  console.log('success!');
});
