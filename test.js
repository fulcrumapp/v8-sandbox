import { Sandbox } from './lib';

import assert from 'assert';

const run = (code, timeout, callback) => {
  return new Sandbox().execute(code, timeout, callback);
};

const jsAsync = `
httpRequest({uri: 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt'}, (err, res, body) => {
  setResult(body);
});
`;

const js = `
const [err, res, body] = httpRequest({uri: 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt'});
const timerID = setTimeout(() => {
  console.log('FINISHED!!!!!');
  setResult(body);
}, 3000);

console.log('timerid', timerID);
clearTimeout(timerID);
// clearTimeout(timerID);
//while(true){};
`;

// run(jsAsync, (err, result) => {
//   assert.equal(result, 'hi there');
//   console.log('success!');
// });

run(js, 1000000, (err, result) => {
  console.log('success!', err, result);
  assert.equal(result, 'hi there');
});
