import { Sandbox } from './lib';

import assert from 'assert';

const run = (code, callback) => {
  return new Sandbox().run(code, callback);
};

const jsAsync = `
httpRequest({uri: 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt'}, (err, res, body) => {
  setResult(body);
});
`;

const js = `
const [err, res, body] = httpRequest({uri: 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt'});
setResult(body);
`;

run(jsAsync, (err, result) => {
  assert.equal(result, 'hi there');
  console.log('success!');
});

run(js, (err, result) => {
  assert.equal(result, 'hi there');
  console.log('success!');
});
