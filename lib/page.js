/**
 * The roster operations page.
 *
 * A local, dependency-free HTTP surface over `roles.json`: list roles, edit any
 * field including the persona, add or delete a role, and apply the result to
 * the running session without a restart (the caller supplies `onApply`).
 *
 * Bound to 127.0.0.1 only and unauthenticated: it edits a file on this machine,
 * which is the same authority the operator already has in a shell. Do not expose
 * the port beyond loopback.
 */

import http from 'node:http'

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>Subagent roster</title>
<style>
 :root { color-scheme: light dark; --line:#8884; --accent:#4a7; }
 * { box-sizing: border-box; }
 body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif; display:grid; grid-template-columns:260px 1fr; height:100vh; }
 aside { border-right:1px solid var(--line); overflow:auto; display:flex; flex-direction:column; }
 aside header { padding:10px 12px; border-bottom:1px solid var(--line); display:flex; gap:6px; flex-wrap:wrap; }
 aside ul { list-style:none; margin:0; padding:0; }
 aside li { padding:7px 12px; cursor:pointer; border-bottom:1px solid var(--line); }
 aside li:hover { background:#8881; }
 aside li.on { background:#8883; font-weight:600; }
 aside li small { display:block; opacity:.6; font-weight:400; }
 main { padding:16px 20px; overflow:auto; }
 label { display:block; margin:10px 0 4px; font-weight:600; }
 input, select, textarea { width:100%; padding:6px 8px; font:inherit; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; }
 textarea { min-height:180px; font-family:ui-monospace,Consolas,monospace; font-size:12px; }
 .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
 .bar { position:sticky; top:0; background:Canvas; padding:8px 0 12px; display:flex; gap:8px; align-items:center; border-bottom:1px solid var(--line); margin-bottom:8px; }
 button { padding:6px 12px; font:inherit; border:1px solid var(--line); border-radius:6px; background:#8881; cursor:pointer; }
 button.primary { border-color:var(--accent); color:var(--accent); font-weight:600; }
 button:disabled { opacity:.4; cursor:default; }
 #problems { white-space:pre-wrap; color:#c33; font-family:ui-monospace,monospace; font-size:12px; }
 #status { opacity:.7; }
</style></head><body>
<aside>
  <header><button id="add">+ 新角色</button><button id="reload">重新加载</button></header>
  <ul id="list"></ul>
</aside>
<main>
  <div class="bar">
    <button class="primary" id="save">保存并应用</button>
    <button id="del">删除此角色</button>
    <span id="status"></span>
  </div>
  <div id="problems"></div>
  <div id="editor"></div>
</main>
<script>
let state = { roles: [], tiers: [], capabilities: [], lines: [] }
let current = 0
const fields = ['id','position','temperament','line','tier','capability','order']
const $ = (id) => document.getElementById(id)
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function role() { return state.roles[current] }

function renderList() {
  $('list').innerHTML = state.roles.map((r, i) =>
    '<li data-i="' + i + '" class="' + (i === current ? 'on' : '') + '">' + esc(r.id) +
    '<small>' + esc(r.line) + ' · ' + esc(r.tier) + ' · ' + esc(r.capability) + '</small></li>').join('')
  for (const li of $('list').querySelectorAll('li')) li.onclick = () => { current = Number(li.dataset.i); render() }
}

function render() {
  const r = role()
  if (!r) { $('editor').innerHTML = '<p>没有角色。</p>'; return }
  const opts = (values, value) => values.map((v) => '<option' + (v === value ? ' selected' : '') + '>' + v + '</option>').join('')
  $('editor').innerHTML = [
    '<div class="row">',
      '<div><label>id</label><input id="f-id" value="' + esc(r.id) + '"></div>',
      '<div><label>order</label><input id="f-order" type="number" value="' + (r.order ?? 999) + '"></div>',
    '</div>',
    '<div class="row">',
      '<div><label>position</label><input id="f-position" value="' + esc(r.position) + '"></div>',
      '<div><label>temperament</label><input id="f-temperament" value="' + esc(r.temperament) + '"></div>',
    '</div>',
    '<div class="row">',
      '<div><label>line</label><select id="f-line">' + opts(state.lines, r.line) + '</select></div>',
      '<div><label>tier</label><select id="f-tier">' + opts(state.tiers, r.tier) + '</select></div>',
    '</div>',
    '<div class="row">',
      '<div><label>capability</label><select id="f-capability">' + opts(state.capabilities, r.capability) + '</select></div>',
      '<div><label>title.zh</label><input id="f-title" value="' + esc((r.title && r.title.zh) || '') + '"></div>',
    '</div>',
    '<label>description.zh</label><input id="f-desc" value="' + esc((r.description && r.description.zh) || '') + '">',
    '<label>persona（子代理的系统提示词，逐行生效）</label><textarea id="f-prompt"></textarea>',
  ].join('')
  $('f-prompt').value = r.prompt
  $('problems').textContent = ''
  renderList()
}

function collect() {
  const r = { ...role() }
  r.id = $('f-id').value.trim()
  r.position = $('f-position').value.trim()
  r.temperament = $('f-temperament').value.trim()
  r.line = $('f-line').value
  r.tier = $('f-tier').value
  r.capability = $('f-capability').value
  r.order = Number($('f-order').value)
  r.title = { ...(r.title || {}), zh: $('f-title').value, en: (r.title && r.title.en) || $('f-title').value }
  r.description = { ...(r.description || {}), zh: $('f-desc').value, en: (r.description && r.description.en) || $('f-desc').value }
  r.prompt = $('f-prompt').value
  state.roles[current] = r
}

async function save() {
  collect()
  $('status').textContent = '保存中…'
  const res = await fetch('api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roles: state.roles }) })
  const body = await res.json()
  if (body.ok) { $('status').textContent = '已应用 · ' + new Date().toLocaleTimeString(); $('problems').textContent = '' ; renderList() }
  else { $('problems').textContent = body.problems.join('\\n'); $('status').textContent = '未保存' }
}

$('save').onclick = save
$('add').onclick = () => {
  collect()
  state.roles.push({ id: 'role-' + (state.roles.length + 1), position: 'custom', temperament: 'custom', line: 'team', tier: 'build', capability: 'read', order: 999, title: { en: 'Custom', zh: '自定义' }, description: { en: '', zh: '' }, prompt: 'You are a specialist. State what you will do, do it, and report the result.' })
  current = state.roles.length - 1
  render()
}
$('del').onclick = () => {
  if (state.roles.length <= 1) { $('problems').textContent = '至少保留一个角色'; return }
  state.roles.splice(current, 1)
  current = Math.max(0, current - 1)
  render()
}
$('reload').onclick = async () => { const r = await fetch('api/state'); state = await r.json(); current = 0; render() }

fetch('api/state').then((r) => r.json()).then((s) => { state = s; current = 0; render(); $('status').textContent = s.file })
</script></body></html>`

/**
 * Start the operations page.
 * @param {object} options - port, roster accessors, and the apply callback.
 * @returns {{port: number, url: string, close: () => Promise<void>}}
 */
export function startPage({ port = 4317, state, save, onApply, host = '127.0.0.1', logger } = {}) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`)
    const send = (status, body, type = 'application/json') => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
      response.end(body)
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(200, PAGE, 'text/html; charset=utf-8')
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return send(200, JSON.stringify(state()))
    }
    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', async () => {
        let payload
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return send(400, JSON.stringify({ ok: false, problems: ['request body is not JSON'] }))
        }
        const result = save(payload.roles)
        if (!result.ok) return send(400, JSON.stringify(result))
        try {
          await onApply?.(payload.roles)
        } catch (error) {
          return send(500, JSON.stringify({ ok: false, problems: [`saved but could not apply: ${error.message}`] }))
        }
        return send(200, JSON.stringify({ ok: true, problems: [] }))
      })
      return undefined
    }
    return send(404, JSON.stringify({ error: 'not found' }))
  })

  server.on('error', (error) => logger?.warn?.(`subagent-roster: operations page unavailable on ${host}:${port}: ${error.message}`))
  server.listen(port, host)
  return {
    port,
    url: `http://${host}:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

