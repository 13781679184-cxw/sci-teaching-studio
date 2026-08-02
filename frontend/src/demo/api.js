import { DEMO_PROJECT_ID } from './mode.js'

const BASE = import.meta.env.BASE_URL || '/'

let packPromise = null
let pack = null
let themeState = null
let outline = null
let lecture = null
let jobSeq = 1

function assetUrl(rel) {
  if (!rel) return null
  if (/^(https?:|data:)/i.test(rel)) return rel
  const path = String(rel).replace(/^\/+/, '')
  return `${BASE}${path}`
}

function fixFigures(figuresPack) {
  const figures = (figuresPack.figures || []).map((f) => ({
    ...f,
    thumb_url: assetUrl(f.thumb_url),
  }))
  return { ...figuresPack, figures }
}

function fixSlides(slidesPack) {
  const slides = (slidesPack.slides || []).map((s) => ({
    ...s,
    figure_thumb_url: assetUrl(s.figure_thumb_url),
    export_thumb_url: assetUrl(s.export_thumb_url),
  }))
  return { ...slidesPack, slides }
}

async function ensurePack() {
  if (pack) return pack
  if (!packPromise) {
    packPromise = fetch(`${BASE}showcase/my-ppt/pack.json`).then(async (r) => {
      if (!r.ok) throw new Error(`showcase pack ${r.status}`)
      const raw = await r.json()
      pack = {
        ...raw,
        figures: fixFigures(raw.figures || {}),
        slides: fixSlides(raw.slides || {}),
      }
      themeState = { ...(pack.theme || {}) }
      outline = structuredClone(pack.outline)
      lecture = pack.lecture || ''
      return pack
    })
  }
  return packPromise
}

function okJob(step) {
  const id = `demo-${jobSeq++}`
  return {
    job_id: id,
    project_id: DEMO_PROJECT_ID,
    step,
    status: 'ok',
    returncode: 0,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    log_tail: `[showcase] ${step} · 静态展示站：不跑真实管线\n`,
    cancel_requested: false,
  }
}

function delay(ms = 200) {
  return new Promise((r) => setTimeout(r, ms))
}

export const demoApi = {
  health: async () => {
    await ensurePack()
    return {
      ok: true,
      demo: true,
      showcase: true,
      deck_root: '(showcase)',
      workspace: '(showcase)',
      python: '(showcase)',
      steps: [],
      providers: { text: false, image: false },
    }
  },
  listProjects: async () => {
    const p = await ensurePack()
    return { projects: p.list || [{ id: DEMO_PROJECT_ID, course_title: p.detail?.course_title }] }
  },
  getProject: async () => {
    const p = await ensurePack()
    return {
      ...p.detail,
      theme_id: themeState.theme_id || p.detail.theme_id,
      theme: {
        ...(p.detail.theme || {}),
        id: themeState.theme_id || p.detail.theme_id,
        accent: themeState.accent || p.detail.theme?.accent,
      },
      page_designs: themeState.page_designs || p.detail.page_designs,
      optional_pages: themeState.optional_pages || p.detail.optional_pages,
    }
  },
  createProject: async () => {
    await delay()
    return { project_id: DEMO_PROJECT_ID, id: DEMO_PROJECT_ID }
  },
  registerUat: async () => ({ ok: true }),
  listMaterials: async () => ({ materials: [] }),
  uploadMaterials: async () => ({ ok: true, count: 0 }),
  getOutline: async () => {
    await ensurePack()
    return outline
  },
  putOutline: async (_id, next) => {
    outline = next
    return outline
  },
  getBrief: async () => ({
    path: 'source/project_brief.md',
    text: '静态展示：真实项目快照（只读浏览）。',
  }),
  putBrief: async () => ({ ok: true }),
  getSources: async () => {
    const p = await ensurePack()
    return p.sources
  },
  decideSource: async () => {
    const p = await ensurePack()
    return p.sources
  },
  addManualSource: async () => {
    const p = await ensurePack()
    return p.sources
  },
  uploadSourcePdfs: async () => ({ ok: true }),
  getFigures: async () => {
    const p = await ensurePack()
    return p.figures
  },
  deleteFigure: async () => ({ ok: true }),
  translateFigureCaption: async (_id, figureId) => {
    const p = await ensurePack()
    const f = (p.figures.figures || []).find((x) => x.figure_id === figureId)
    return { caption_zh: f?.caption_zh || f?.caption || '' }
  },
  listVisualSnapshots: async () => ({ snapshots: [] }),
  restoreVisualSnapshot: async () => ({ restored_from: null, count: 0 }),
  getSlides: async () => {
    const p = await ensurePack()
    return p.slides
  },
  getQa: async () => {
    const p = await ensurePack()
    return p.qa || { status: 'pass' }
  },
  getLectureScript: async () => {
    await ensurePack()
    return { text: lecture }
  },
  putLectureScript: async (_id, text) => {
    lecture = text
    return { ok: true }
  },
  regenerateLecturePage: async () => ({ ok: true }),
  confirmGate: async () => ({ ok: true }),
  startJob: async (_id, step) => {
    await delay(350)
    return okJob(step)
  },
  getJob: async (jobId) => ({
    job_id: jobId,
    project_id: DEMO_PROJECT_ID,
    step: 'showcase',
    status: 'ok',
    returncode: 0,
    log_tail: '[showcase] done\n',
  }),
  cancelJob: async () => ({ ok: true }),
  listJobs: async () => ({ jobs: [] }),
  downloadUrl: () => '#',
  packDownloadUrl: () => '#',
  copilotOutline: async () => ({
    ok: true,
    summary: '展示站为只读快照，副驾未连接。',
    actions: [],
  }),
  copilotStudio: async () => ({
    ok: true,
    summary: '展示站：界面与样例项目同你本机；检索/生图/导出不会真正执行。',
    actions: [],
  }),
  copilotFigure: async () => ({ ok: true, prompt_history: [] }),
  figurePromptHistory: async () => ({ history: [] }),
  clearFigurePrompt: async () => ({ ok: true }),
  listThemes: async () => {
    await ensurePack()
    return {
      default: themeState?.theme_id || 'green',
      default_designs: themeState?.page_designs || {},
      themes: [
        { id: 'green', name: '松叶绿', accent: '#2F5D50', board: 'white' },
        { id: 'blue', name: '湖水蓝', accent: '#2F5D8A', board: 'white' },
        { id: 'terracotta', name: '陶土', accent: '#A65D3F', board: 'white' },
      ],
      designs: null,
    }
  },
  getTheme: async () => {
    await ensurePack()
    return {
      ...themeState,
      designs: themeState.page_designs,
    }
  },
  putTheme: async (_id, payload) => {
    await ensurePack()
    const p = typeof payload === 'string' ? { theme_id: payload } : payload || {}
    if (p.theme_id) themeState.theme_id = p.theme_id
    if (p.accent) themeState.accent = p.accent
    if (p.page_designs) themeState.page_designs = { ...themeState.page_designs, ...p.page_designs }
    if (p.optional_pages) themeState.optional_pages = { ...themeState.optional_pages, ...p.optional_pages }
    await delay(150)
    return { ...themeState, designs: themeState.page_designs }
  },
}
