import { IS_DEMO } from './demo/mode.js'
import { demoApi } from './demo/api.js'

const BASE = '/api'

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || res.statusText
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

const liveApi = {
  health: () => req('/health'),
  listProjects: () => req('/projects'),
  getProject: (id) => req(`/projects/${id}`),
  createProject: (body) => req('/projects', { method: 'POST', body: JSON.stringify(body) }),
  registerUat: (id) => req(`/projects/${id}/register-uat`, { method: 'POST', body: '{}' }),
  listMaterials: (id) => req(`/projects/${id}/materials`),
  uploadMaterials: async (id, files) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    const res = await fetch(`${BASE}/projects/${id}/materials`, { method: 'POST', body: fd })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    if (!res.ok) {
      const msg = (data && (data.detail || data.error)) || res.statusText
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
    return data
  },
  getOutline: (id) => req(`/projects/${id}/artifact?path=${encodeURIComponent('source/outline.json')}`),
  putOutline: (id, outline) =>
    req(`/projects/${id}/outline`, { method: 'PUT', body: JSON.stringify(outline) }),
  getBrief: (id) => req(`/projects/${id}/artifact?path=${encodeURIComponent('source/project_brief.md')}`),
  putBrief: (id, text) =>
    req(`/projects/${id}/brief`, { method: 'PUT', body: JSON.stringify({ text }) }),
  getSources: (id) => req(`/projects/${id}/sources`),
  decideSource: (id, source_id, user_confirmation, reason) =>
    req(`/projects/${id}/sources/decide`, {
      method: 'POST',
      body: JSON.stringify({ source_id, user_confirmation, reason }),
    }),
  addManualSource: (id, body) =>
    req(`/projects/${id}/sources/manual`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadSourcePdfs: async (id, files) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    const res = await fetch(`${BASE}/projects/${id}/sources/upload`, { method: 'POST', body: fd })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    if (!res.ok) {
      const msg = (data && (data.detail || data.error)) || res.statusText
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
    return data
  },
  getFigures: (id) => req(`/projects/${id}/figures`),
  deleteFigure: (id, figureId) =>
    req(`/projects/${id}/figures/${encodeURIComponent(figureId)}`, { method: 'DELETE' }),
  translateFigureCaption: (id, figureId) =>
    req(`/projects/${id}/figures/${encodeURIComponent(figureId)}/translate-caption`, {
      method: 'POST',
      body: '{}',
    }),
  listVisualSnapshots: (id) => req(`/projects/${id}/visual-snapshots`),
  restoreVisualSnapshot: (id, snapshotId) =>
    req(
      `/projects/${id}/visual-snapshots/restore${
        snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : ''
      }`,
      { method: 'POST', body: '{}' },
    ),
  listOutlineSnapshots: (id) => req(`/projects/${id}/outline-snapshots`),
  restoreOutlineSnapshot: (id, snapshotId) =>
    req(
      `/projects/${id}/outline-snapshots/restore${
        snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : ''
      }`,
      { method: 'POST', body: '{}' },
    ),
  getSlides: (id) => req(`/projects/${id}/slides`),
  getQa: (id) => req(`/projects/${id}/qa`),
  getLectureScript: (id) => req(`/projects/${id}/lecture-script`),
  putLectureScript: (id, text) =>
    req(`/projects/${id}/lecture-script`, { method: 'PUT', body: JSON.stringify({ text }) }),
  regenerateLecturePage: (id, pageId, { pptx } = {}) =>
    req(`/projects/${id}/lecture-script/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ page_id: pageId, pptx: pptx || null }),
    }),
  confirmGate: (id, gate, body = {}) =>
    req(`/projects/${id}/gates/${gate}/confirm`, { method: 'POST', body: JSON.stringify(body) }),
  startJob: (id, step, extra = {}) =>
    req(`/projects/${id}/jobs`, { method: 'POST', body: JSON.stringify({ step, ...extra }) }),
  getJob: (jobId) => req(`/jobs/${jobId}`),
  cancelJob: (jobId) => req(`/jobs/${jobId}/cancel`, { method: 'POST', body: '{}' }),
  listJobs: (id) => req(`/projects/${id}/jobs`),
  /** LangGraph agent pipeline (HITL interrupts at outline/sources/figures). */
  startAgent: (id, body = {}) =>
    req(`/projects/${id}/agent/run`, { method: 'POST', body: JSON.stringify(body) }),
  resumeAgent: (id, body) =>
    req(`/projects/${id}/agent/resume`, { method: 'POST', body: JSON.stringify(body) }),
  listAgentThreads: (id) => req(`/projects/${id}/agent/threads`),
  getAgentThread: (threadId) => req(`/agent/threads/${threadId}`),
  downloadUrl: (id, path) =>
    `${BASE}/projects/${id}/artifact?path=${encodeURIComponent(path)}`,
  packDownloadUrl: (id) => `${BASE}/projects/${id}/download-pack`,
  copilotOutline: (id, message) =>
    req(`/projects/${id}/copilot/outline`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  copilotStudio: (id, { screen, message, page_id } = {}) =>
    req(`/projects/${id}/copilot/studio`, {
      method: 'POST',
      body: JSON.stringify({ screen, message, page_id: page_id || null }),
    }),
  copilotFigure: (id, pageId, message) =>
    req(`/projects/${id}/copilot/figure`, {
      method: 'POST',
      body: JSON.stringify({ page_id: pageId, message }),
    }),
  figurePromptHistory: (id, pageId) =>
    req(`/projects/${id}/copilot/figure/history?page_id=${encodeURIComponent(pageId)}`),
  clearFigurePrompt: (id, { pageId, allPages } = {}) =>
    req(`/projects/${id}/copilot/figure/clear`, {
      method: 'POST',
      body: JSON.stringify({
        page_id: pageId || null,
        all_pages: Boolean(allPages),
      }),
    }),
  listThemes: () => req('/themes'),
  getTheme: (id) => req(`/projects/${id}/theme`),
  putTheme: (id, payload) =>
    req(`/projects/${id}/theme`, {
      method: 'PUT',
      body: JSON.stringify(
        typeof payload === 'string' ? { theme_id: payload } : payload || {},
      ),
    }),
}

export const api = IS_DEMO ? demoApi : liveApi
