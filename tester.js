const Sandbox = require('./dist/sandbox').default;

const sandbox = new Sandbox();

const code = `
const value = dispatchSync('test', [1, 2, 3]);

dispatchAsync('testAsync', [1, 2, 3], (err, res) => {
  setResult({ value: res });
});
`;

sandbox.execute({ code }, (result) => {
  console.log('RESULT', result);
});