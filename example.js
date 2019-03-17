import Sandbox from './dist';
import path from 'path';

const sandbox = new Sandbox({require: path.join(process.cwd(), 'example-functions.js')});

const run = (code, callback) => {
  sandbox.execute(code, 1000, callback);
};

const example1 = `
setResult({value: [21, 22]});
`;

// call a custom synchronous host function
const example2 = `
setResult({value: dispatchSync('testSync', [1, 2])});
`;

// call a custom asynchronous host function
const example3 = `
dispatchAsync('testAsync', [1, 2], function(error, value) {
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

run(example1, (err, result) => {
  console.log('example 1:', result);

  run(example2, (err, result) => {
    console.log('example 2:', result);

    run(example3, (err, result) => {
      console.log('example 3:', result);

      run(example4, (err, result) => {
        console.log('example 4:', result);

        run(example5, (err, result) => {
          console.log('example 5:', result);

          sandbox.shutdown();
        });
      });
    });
  });
});
