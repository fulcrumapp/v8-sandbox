# v8-sandbox

Safely execute arbitrary untrusted JavaScript from nodejs. This module implements an isolated JavaScript environment that can be used to run any code without being able to escape the sandbox. The V8 context is initialized and executed entirely from C++ so it's impossible for the JS stack frames to lead back to the nodejs environment. It's usable from a nodejs process, but the JS environment is pure V8. The sandboxed V8 context is executed from a separate nodejs process to enable full support for script timeouts.

It's intentionally not possible to expose any nodejs objects or functions directly to the sandbox. This makes it slightly harder to integrate into a project, but has the benefit of guaranteed isolation. There is however a mechanism to invoke host functions from the sandbox using the `require` constructor option of the Sandbox. The host dispatch feature uses JSON serialization over IPC for all parameters and return values so it's not possible to pass any object references between the environments. All communication between the sandbox instance of V8 and the nodejs instance of V8 is done through JSON serialization to completely prevent leaking any references into the sandbox. See `example.js` and `example-functions.js` for a sample of how to expose nodejs functions to the sandbox.

# Features

* Isolated sandbox for executing arbitrary JS
* Asynchronous function support (e.g. `setTimeout` and `httpRequest`). The built-in `setResult` function defines the final result of the sandbox execution
* Optional worker cluster for parallel execution of multiple scripts
* Timeout support
* Gracefully handle and recover from OOM errors and hard crashes
* Expose nodejs (host) functionality selectively using `require` parameter `new Sandbox({ require: 'path-to-file.js' })`. This file will be required by the workers and define both synchronous and asynchronous functions that can be called from the sandbox. See `example.js` and `example-functions.js` for a sample of how to expose native functions to the sandbox. Note that the native functions cannot be directly exposed, all input and output from the native functions is serialized with JSON between native <--> sandbox.
* Support for a `template` script that gets executed upon initialization of each sandbox instance. This is useful if you have large libraries or setup code before calling the user code. When using this library in a web app, this feature can massively improve performance since a worker will be "pre-warmed" with your setup code by the time you execute the actual user code. For example, if you want to provide some helper functions to all code that's executed in the sandbox. This is mostly intended for use with the cluster feature since the template code is executed on initialization. In a server environment, when the time comes to execute user code in a request, the cluster worker will already be pre-warmed with the template code and only need to execute the user code.

# Installation

```sh
npm install v8-sandbox
```

# API

## Constructor

**`new Sandbox({ require, template, httpEnabled, timersEnabled, memory, argv })`**

- `require`: `string` (optional) require this javascript file from the nodejs side
- `template`: `string` (optional) script to load with every
- `httpEnabled`: `boolean` (optional) enable the `httpRequest` function (default: `true`)
- `timersEnabled`: `boolean` (optional) enable the `setTimeout` and `clearTimeout` functions (default: `true`)
- `memory`: `number` (optional) set the amount of memory available to the sandbox (default: `null`, nodejs defaults)
- `argv`: `string[]` (optional) set the flags passed to the nodejs process hosting the sandbox (default: `[]`) example: `[ '--harmony' ]`
- `uid`: `string` (optional) user id to run the sandbox as (default: `null`, same as running process)
- `gid`: `string` (optional) group id to run the sandbox as (default: `null`, same as running process)

**`async execute({ code, timeout, globals, context })`**

- `code`: `string` code to execute
- `timeout`: `number` (optional) script timeout (default: `null`, no timeout)
- `globals`: `object` (optional) global variables to make available to the script
- `context`: `object` (optional) data to make available to the nodejs host process. This is only necessary if you're using a `require` script. `context` is how you pass data in to make it available to the custom `require` script. The context object will be passed in to the host functions.

You *must* use the `setResult({ value, error })` function in the `code` to set the result of the execution. Using this function is required in order to fully support async code and promises within the sandbox.

**`async initialize({ timeout })`**

- `timeout`: `number` (optional) initialization timeout

Initialize the sandbox by evaluating the built-in runtime and any `template` script. Can be useful if your template script is complex and you want `execute()` to be as fast as possible with no "start-up" overhead. This method is automatically called by `execute()` if the sandbox is not already initialized. The cluster feature uses this method to warm up a sandbox instance so it's ready to use.

**`async shutdown()`**

Shutdown the sandbox instance. Stops the nodejs host process. You must call `shutdown()` at some point in your program if you want the nodejs process to exit.

## Examples

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = 'setResult({ value: 1 + inputValue });';

(async () => {
  const { error, value } = await sandbox.execute({ code, timeout: 3000, globals: { inputValue: 2 } });

  await sandbox.shutdown();

  console.log(value);
  //=> 3
})();
```


```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = `
let numberValue = 1;

setTimeout(() => {
  // call setResult to set the final result of the script to accommodate async code
  setResult({value: numberValue + 1});
}, 20);
`;

(async () => {
  const { error, value } = await sandbox.execute({ code, timeout: 3000 });

  await sandbox.shutdown();

  console.log(value);
  //=> 2
})();
```

```js
import Sandbox from 'v8-sandbox';

const sandbox = new Sandbox();

const code = 'while (true) {}';

(async () => {
  const { error, value } = await sandbox.execute({ code, timeout: 3000 });

  await sandbox.shutdown();

  console.log(error.isTimeout);
  //=> true
})();
```

# Host functions

Host functions can be used to selectively expose nodejs functionality to the sandbox. Because the sandbox is inside a child process, the machinery for exposing nodejs functionality is somewhat complex. Host functions are setup using the `require` option when creating a sandbox. The file passed as `require` is executed in the trusted nodejs host and can define functions the sandboxed code can call.

Depending on what functionality is being exposed, host functions can take one of the following forms:

1. Synchronous from the sandbox and synchronous in the nodejs process (use `respond(result)`)
2. Synchronous from the sandbox but asynchronous in the nodejs process (call async code and some time later call `respond(result)`)
3. Asynchronous from the sandbox and asynchronous in the nodejs process (start async work and call `respond()` and later call `callback(error, value)`)

You must always call `respond()` or `fail()` to transfer control back to the sandbox. The sandbox execution remains suspended until `respond()` or `fail()` is called.

**`function nodeFunction(args, { respond, fail, callback, context })`**

- `args`: `array` arguments passed to the function from the sandbox
- `respond`: `function` respond to the sandbox with a return value
- `fail`: `function` respond to the sandbox with an error
- `callback`: `function` the callback passed from the sandbox for an async function, signature: `callback(error, value)`
- `context`: `object` (optional) the context variables passed into this execution

Host functions take the form:

```js
// called from inside sandbox as `nodeFunctionSync(arg1, arg2, arg3)`
function nodeFunctionSync([ arg1, arg2, arg3 ], { respond, fail, context }) {
  respond('return value'); // you must call this to complete this invocation and pass control back to the sandbox
  // or
  fail(new Error('fail')); // or can call fail(), which causes the entire invocation to fail
}

// called from inside sandbox as `nodeFunctionAsync(arg1, arg2, arg3, (err, result) => {})`
function nodeFunctionAsync([ arg1, arg2, arg3 ], { respond, fail, callback, context }) {
  setTimeout(() => {
    callback(null, 10);
  }, 100);

  respond(); // you must call this to complete this invocation and pass control back to the sandbox
}
```
