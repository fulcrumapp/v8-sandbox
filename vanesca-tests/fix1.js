
process.stdout.write("\u001b[2J\u001b[00H") // clear screen
const { Sandbox, SandboxCluster } = require('../v8-sandbox')
let sandbox = new Sandbox({ memory: 1000, require: __dirname + '/functions1.js' })

let code = `
    async function test() {

        // always works! (water-fall/callback embedded)
        addNumbers(1, 2, function(result) {
            if(result.error) console.log('error1:', result.error)
            if(result.value) console.log('value1:', result.value)
        })

        // only works with the runtime.js fix (standard await)
        // otherwise the last argument is removed, because it expects a callback (embedded)
        let {error, value} = await addNumbers(1, 2)
        if(error) console.log('error2:', error)
        if(value) console.log('value2:', value)
    }
    test()
`; // always end with semicolon

(async () => {

    // test 1 (runs in async)
    await sandbox.execute({ code })
})()