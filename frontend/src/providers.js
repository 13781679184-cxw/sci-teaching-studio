import { IS_DEMO } from './demo/mode.js'
import { DEMO_PROVIDERS } from './demo/data.js'

const LS_KEY = 'sci.studio.providers.v1'

export function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveDraft(d) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(d || {}))
  } catch {
    /* ignore */
  }
}

export async function fetchState() {
  if (IS_DEMO) return DEMO_PROVIDERS
  const r = await fetch('/api/providers')
  if (!r.ok) throw new Error('providers ' + r.status)
  return r.json()
}

export async function saveToServer(payload) {
  if (IS_DEMO) return { ...DEMO_PROVIDERS, ...payload, demo: true }
  const r = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || d.error || 'save ' + r.status)
  return d
}

export async function testConn(payload) {
  if (IS_DEMO) return { ok: false, detail: '演示模式：未连接真实服务', models: [] }
  try {
    const r = await fetch('/api/providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return await r.json()
  } catch (e) {
    return { ok: false, detail: '请求失败：' + e.message, models: [] }
  }
}
