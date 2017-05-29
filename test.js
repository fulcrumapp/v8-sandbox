import { Sandbox } from './dist';
// import Sandbox from './lib/sandbox';

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
clearTimeout(timerID);
//while(true){};
`;

const jsInfinite1 = `
setTimeout(() => {}, 10000);
let i = 0;

  console.log(i++);
const createTimeout = () => {
  console.log(i++);
  setTimeout(() => {
    createTimeout();
  }, 1);
};

createTimeout();
`;

const jsInfinite = `
setTimeout(() => {}, 10000);
`;

const jsTest = `
httpRequest({uri: 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt'}, (err, res, body) => {
  setResult({value: body});
});
`;

const jsTest2 = `
setResult(1337);
`;

const jsTest3 = `
while (true) {}
throw new Error('yo');
`;

const jsTest4 = `
setTimeout(() => {

}, 1000);
`;

// run(jsAsync, (err, result) => {
//   assert.equal(result, 'hi there');
//   console.log('success!');
// });

// new Sandbox().execute(jsTest, (err, result) => {
//   console.log('success!', err, result);
// });
run(jsTest4, 10000, (err, result) => {
  if (err && err.isTimeout) {
    console.log('TIMEOUT!');
  }

  console.log('success!', err, result);
  // assert.equal(result, 'hi there');
});
