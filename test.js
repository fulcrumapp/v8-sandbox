const Sandbox = require('./dist').default;
const assert = require('assert');

const sandbox = new Sandbox();

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
  setResult({ value: 1 });
}, 1000);
`;

const jsTest5 = `
function test() {
  // xxxxxxx%


  throw new Error('wha')
  setResult({value: 1});
}

(() => {
  test();
})();
`.trim();

const jsTest6 = '}';

// run(jsAsync, (err, result) => {
//   assert.equal(result, 'hi there');
//   console.log('success!');
// });

// new Sandbox().execute(jsTest, (err, result) => {
//   console.log('success!', err, result);
// });

(async () => {
  const { error, value } = await sandbox.execute({ code: jsTest5, timeout: 4000 });

  if (error && error.isTimeout) {
    console.log('TIMEOUT!');
  }

  if (error) {
    console.error(error);
  } else {
    console.log('success!', value);
  }

  await sandbox.shutdown();
})();
