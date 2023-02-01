
process.stdout.write("\u001b[2J\u001b[00H") // clear screen
const { Sandbox, SandboxCluster } = require('../v8-sandbox')
let sandbox = new Sandbox({ memory: 1000 })

let code1 = `
    let t = 1
    console.log(t) // works
`; // always end with semicolon

let code2 = ` // repeated executes STACK and should keep their values
    t++
    console.log(t)
`;

(async () => {

    const RUN = 4
    console.log('Test no.' + RUN)

    // test 1 (runs in sync) (works)
    if(RUN === 1) {
        sandbox.execute({ code: code1 })
        sandbox.execute({ code: code2 })
    }

    //////////////////////////////////////////

    // test 2 (runs first in async/second sync) (doesn't work, even though it should!)
    if(RUN === 2) {
        await sandbox.execute({ code: code1 })
        sandbox.execute({ code: code2 })
    }

    //////////////////////////////////////////

    // test 3 (run in async) (doesn't work, even though it should!)
    if(RUN === 3) {
        await sandbox.execute({ code: code1 })
        await sandbox.execute({ code: code2 })
    }

    //////////////////////////////////////////

    // test 4 (promise result also doesn't work, even though it should!)
    if(RUN === 4) {
        sandbox.execute({ code: code1 }).then(() =>
            // doesn't work, even though it should!
            // because of a flag being reset in sandbox.js code
            // this is fixed now.
            setTimeout(async() => {
               sandbox.execute({ code: code2 }) // should display '2' (after fix)
            }, 2000)
        )
    }
})()