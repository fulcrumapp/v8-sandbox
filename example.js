import Sandbox from './dist';

const sandbox = new Sandbox();

const js = `
setResult({value: 1});
`;

sandbox.execute(js, 3000, (err, value) => {
  console.log(value);
  sandbox.shutdown();
});
