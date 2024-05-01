
// Create or require your own functions and libraries (more safe)

// Async (water-fall method / callback)
defineAsync('addNumbers', ([ value1, value2 ], { respond, callback }) => {
    respond() // always required!
    setTimeout(() => {
        callback({error: null, value: value1 + value2}) // send to sandbox
    }, 1000) // 1 sec delay (for testing)
})