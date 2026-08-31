import bcrypt from 'bcryptjs'

function readPipedInput() {
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { value += chunk })
    process.stdin.on('end', () => resolve(value.replace(/[\r\n]+$/, '')))
    process.stdin.on('error', reject)
  })
}

function readHiddenInput(prompt) {
  return new Promise((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    const onData = (chunk) => {
      const input = String(chunk)
      for (const character of input) {
        if (character === '\u0003') {
          cleanup()
          process.stderr.write('\n')
          reject(new Error('Cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          process.stderr.write('\n')
          resolve(value)
          return
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length) {
            value = value.slice(0, -1)
            process.stderr.write('\b \b')
          }
          continue
        }
        value += character
        process.stderr.write('*')
      }
    }
    process.stderr.write(prompt)
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

try {
  let password
  if (process.stdin.isTTY) {
    password = await readHiddenInput('Management admin password: ')
    const confirmation = await readHiddenInput('Confirm management admin password: ')
    if (password !== confirmation) throw new Error('Passwords do not match.')
  } else {
    password = await readPipedInput()
  }

  if (password.length < 12) throw new Error('Password must contain at least 12 characters.')
  process.stdout.write(`${await bcrypt.hash(password, 12)}\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
