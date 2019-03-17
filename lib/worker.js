import Sandbox from './sandbox';

global.$exports = {};

process.on('message', (message) => {
  if (message.require) {
    require(message.require);
    return;
  }

  const sandbox = new Sandbox();

  sandbox.execute(message.code, (err, value) => {
    process.send({err, value});
  });
});
