import Sandbox from './sandbox';

process.on('message', (message) => {
  const sandbox = new Sandbox();

  sandbox.execute(message.code, (err, value) => {
    process.send({err, value});
    process.disconnect();
  });
});
