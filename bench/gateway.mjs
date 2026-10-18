#!/usr/bin/env node
/**
 * Local OpenAI-compatible gateway for bench runs.
 *
 * Why this exists: Docker Desktop's engine is not startable without elevation on
 * this machine, so the original `new-api` container (the thing that used to
 * expose 127.0.0.1:3002) cannot be brought up. This process restores the exact
 * same contract the plugin was specified against — an OpenAI-compatible
 * `/v1/chat/completions` on port 3002 — and adds something new-api did not give
 * us: one JSONL line per upstream call, which is what makes the 1000-call test
 * budget auditable instead of estimated.
 *
 * Upstream is OpenRouter with the same 21-key free pool the new-api channel
 * held. Keys are read from a file outside the repository and never logged.
 *
 * Usage:
 *   node bench/gateway.mjs
 *   OR_BUDGET=1000 OR_PORT=3002 node bench/gateway.mjs
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const stateDir = path.join(here, 'state')
fs.mkdirSync(stateDir, { recursive: true })

const PORT = Number(process.env.OR_PORT ?? 3002)
const BUDGET = Number(process.env.OR_BUDGET ?? 1000)
const UPSTREAM = process.env.OR_UPSTREAM ?? 'https://openrouter.ai/api/v1'
const KEYS_FILE =
  process.env.OR_KEYS_FILE ??
  path.resolve(repoRoot, '..', '.secrets', 'openrouter-keys.txt')
const LOG = path.join(stateDir, 'calls.jsonl')
const MODELS_FILE = path.join(here, 'models.json')

const keys = fs
  .readFileSync(KEYS_FILE, 'utf8')
  .split(/\r?\n/)
  .map((k) => k.trim())
  .filter((k) => k.startsWith('sk-'))
if (keys.length === 0) throw new Error(`no keys in ${KEYS_FILE}`)

let cursor = 0
let calls = 0
let inflight = 0

const models = fs.existsSync(MODELS_FILE)
  ? JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'))
  : []

let routingSection = null
let systemTotalChars = 0

function log(entry) {
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n')
}

function nextKey() {
  const key = keys[cursor % keys.length]
  cursor += 1
  return key
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    return json(res, 200, {
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', owned_by: 'openrouter' })),
    })
  }

  if (req.method === 'GET' && url.pathname === '/__bench/status') {
    return json(res, 200, { calls, budget: BUDGET, remaining: BUDGET - calls, inflight, keys: keys.length })
  }

  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    return json(res, 404, { error: { message: `unsupported ${req.method} ${url.pathname}` } })
  }

  const raw = await readBody(req)
  if (calls >= BUDGET) {
    log({ ts: new Date().toISOString(), status: 429, reason: 'budget-exhausted', calls })
    return json(res, 429, {
      error: { message: `bench budget of ${BUDGET} calls exhausted`, type: 'budget_exhausted' },
    })
  }

  let payload
  try {
    payload = JSON.parse(raw.toString('utf8'))
  } catch {
    return json(res, 400, { error: { message: 'invalid JSON body' } })
  }

  const started = Date.now()
  const wantStream = payload.stream === true
  const attemptKey = (index) => keys[index % keys.length]

  let lastStatus = 0
  let lastText = ''
  for (let attempt = 0; attempt < Math.min(keys.length, 6); attempt++) {
    const key = attemptKey(cursor)
    cursor += 1
    calls += 1
    inflight += 1
    let upstream
    try {
      upstream = await fetch(`${UPSTREAM}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'x-title': 'dsh-subagent-roster-bench',
        },
        body: JSON.stringify({ ...payload, stream: wantStream }),
      })
    } catch (error) {
      inflight -= 1
      lastStatus = 0
      lastText = String(error?.message ?? error)
      log({
        ts: new Date().toISOString(),
        model: payload.model,
        stream: wantStream,
        status: 0,
        error: lastText,
        ms: Date.now() - started,
        attempt,
        calls,
      })
      continue
    }

    if (upstream.status === 429 || upstream.status === 402 || upstream.status >= 500) {
      lastStatus = upstream.status
      lastText = (await upstream.text()).slice(0, 500)
      inflight -= 1
      log({
        ts: new Date().toISOString(),
        model: payload.model,
        stream: wantStream,
        status: lastStatus,
        error: lastText,
        ms: Date.now() - started,
        attempt,
        rotation: true,
        calls,
      })
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      continue
    }

    // Success path: stream through untouched, or buffer and log usage.
    if (!upstream.ok) {
      inflight -= 1
      res.writeHead(upstream.status, { 'content-type': 'application/json' })
      res.end(Buffer.from(await upstream.arrayBuffer()))
      log({ ts: new Date().toISOString(), model: payload.model, status: upstream.status, stream: wantStream, ms: Date.now() - started, calls })
      return
    }

    if (wantStream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true })
          buffered += text
          res.write(value)
        }
      } catch (error) {
        // A dropped upstream socket must not take the whole bench down.
        log({ ts: new Date().toISOString(), model: payload.model, status: 0, stream: true, error: String(error?.message ?? error), ms: Date.now() - started, calls })
        if (!res.writableEnded) res.end()
      } finally {
        inflight -= 1
        res.end()
        const usage = /"usage"\s*:\s*(\{[^}]*\})/.exec(buffered)
        log({
          ts: new Date().toISOString(),
          model: payload.model,
          status: upstream.status,
          stream: true,
          ms: Date.now() - started,
          usage: usage ? usage[1] : null,
          tools: Array.isArray(payload.tools) ? payload.tools.length : 0,
          systemChars: firstSystemChars(payload),
          routingSection,
          systemTotalChars,
          calls,
        })
      }
      return
    }

    const text = await upstream.text()
    inflight -= 1
    res.writeHead(upstream.status, { 'content-type': 'application/json' })
    res.end(text)
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {}
    log({
      ts: new Date().toISOString(),
      model: payload.model,
      status: upstream.status,
      stream: false,
      ms: Date.now() - started,
      usage: parsed?.usage ?? null,
      finish: parsed?.choices?.[0]?.finish_reason ?? null,
      tools: Array.isArray(payload.tools) ? payload.tools.length : 0,
      systemChars: firstSystemChars(payload),
      routingSection,
      systemTotalChars,
      calls,
    })
    return
  }

  inflight -= 1
  json(res, 502, { error: { message: `upstream failed after rotation: ${lastStatus} ${lastText}` } })
})

function firstSystemChars(payload) {
  const msg = (payload.messages ?? []).find((m) => m.role === 'system')
  const text = typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c) => c?.text ?? '').join('') : ''
  if (!text) return ''
  // The roster section sits far past the first screenful, so record whether the
  // whole system prompt carries it rather than relying on a truncated head.
  routingSection = text.includes('## Delegation shapes')
  systemTotalChars = text.length
  return text.slice(0, 4000)
}

// A single slow model must not wedge the whole bench run.
server.requestTimeout = 15 * 60 * 1000
server.headersTimeout = 15 * 60 * 1000

process.on('uncaughtException', (error) => {
  console.error('[gateway] uncaught:', error?.message ?? error)
})
process.on('unhandledRejection', (error) => {
  console.error('[gateway] unhandled rejection:', error?.message ?? error)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[gateway] listening on http://127.0.0.1:${PORT} keys=${keys.length} budget=${BUDGET} upstream=${UPSTREAM}`)
})


