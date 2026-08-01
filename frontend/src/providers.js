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
  const r = await fetch('/api/providers')
  if (!r.ok) throw new Error('providers ' + r.status)
  return r.json()
}

export async function saveToServer(payload) {
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
