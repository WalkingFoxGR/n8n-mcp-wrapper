import http from 'node:http'
import { spawn } from 'node:child_process'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'

const PORT = Number(process.env.PORT || 3000)
const COMMAND = process.env.MCP_COMMAND || 'npx'

function parseJson(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseArgs(value) {
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) return parsed.map(String)
  if (!value) return ['-y', '@makafeli/n8n-workflow-builder']
  return value.split(' ').filter(Boolean)
}

const args = parseArgs(process.env.MCP_ARGS)
const extraEnv = parseJson(process.env.MCP_ENV) || {}
const childEnv = { ...process.env, ...extraEnv }

const child = spawn(COMMAND, args, {
  env: childEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
})

child.on('exit', (code) => {
  console.error(`[MCP Wrapper] MCP process exited with code ${code}`)
  for (const pending of pendingRequests.values()) {
    pending.reject(new Error('MCP process exited'))
  }
  pendingRequests.clear()
})

child.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf8').trim()
  if (text) {
    console.error(`[MCP Wrapper] ${text}`)
  }
})

const readBuffer = new ReadBuffer()
const pendingRequests = new Map()

child.stdout.on('data', (chunk) => {
  readBuffer.append(chunk)
  let message = readBuffer.readMessage()
  while (message) {
    if (message && typeof message === 'object' && 'id' in message) {
      const pending = pendingRequests.get(message.id)
      if (pending) {
        clearTimeout(pending.timeout)
        pending.resolve(message)
        pendingRequests.delete(message.id)
      }
    }
    message = readBuffer.readMessage()
  }
})

function sendToMcp(message, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!child.stdin.writable) {
      reject(new Error('MCP process is not writable'))
      return
    }

    if (message && typeof message === 'object' && 'id' in message) {
      const timeout = setTimeout(() => {
        pendingRequests.delete(message.id)
        reject(new Error('MCP request timed out'))
      }, timeoutMs)

      pendingRequests.set(message.id, { resolve, reject, timeout })
      child.stdin.write(serializeMessage(message))
      return
    }

    child.stdin.write(serializeMessage(message))
    resolve(null)
  })
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk.toString('utf8')
      if (data.length > 1024 * 1024) {
        reject(new Error('Body too large'))
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const body = await readBody(req)
    const message = JSON.parse(body)

    if (Array.isArray(message)) {
      const results = await Promise.all(message.map((item) => sendToMcp(item)))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(results.filter(Boolean)))
      return
    }

    const result = await sendToMcp(message)
    if (!result) {
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: message }))
  }
})

server.listen(PORT, () => {
  console.log(`[MCP Wrapper] Listening on port ${PORT}`)
  console.log(`[MCP Wrapper] Command: ${COMMAND} ${args.join(' ')}`)
})
