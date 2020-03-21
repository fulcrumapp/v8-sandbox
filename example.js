const Sandbox = require('./dist').default;
const path = require('path');

const sandbox = new Sandbox({ require: path.join(process.cwd(), 'example-functions.js') });

const timeout = 1000;

const run = (code) => {
  return sandbox.execute({ code, timeout });
};

const example1 = `
setResult({value: [21, 22]});
`;

// call a custom synchronous host function
const example2 = `
setResult({value: addNumbers(1, 2)});
`;

// call a custom asynchronous host function
const example3 = `
addNumbersAsync(1, 2, function(error, value) {
  setResult({error, value});
});
`;

// synchronous http request
const example4 = `
const response = httpRequest({uri: 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt'});
setResult({value: response.body});
`;

// asynchronous http request
const example5 = `
var response = httpRequest({uri: 'https://gist.githubusercontent.com/zhm/39714de5e103126561da5f60e0fe0ce2/raw/46c1114c9f78a75d67dc4100d7e5e4d63ea5c583/gistfile1.txt'}, (err, res, body) => {
  setResult({value: body});
});
`;

const runExample = async (code) => {
  const { error, value } = await run(code);

  if (error) {
    console.error(error);
  }

  return value;
};

(async () => {
  console.log('example 1:', await runExample(example1));
  console.log('example 2:', await runExample(example2));
  console.log('example 3:', await runExample(example3));
  console.log('example 4:', await runExample(example4));
  console.log('example 5:', await runExample(example5));

  for (let i = 0; i < 100; ++i) {
    console.log('example 2:', await runExample(example2));
  }

  sandbox.shutdown();
})();

