import { DEMO_PROJECT_ID, DEMO_COURSE_TITLE } from './mode.js'

const BASE = import.meta.env.BASE_URL || '/'

let packPromise = null
let pack = null
let themeState = null
let outline = null
let lecture = null
let jobSeq = 1
const jobStore = new Map()

/** Progressive unlock so「开始生成」walks like a new project, then reveals packed data. */
let reveal = {
  outline: false,
  sources: false,
  figures: false,
  slides: false,
}

export function resetDemoWalkthrough() {
  reveal = { outline: false, sources: false, figures: false, slides: false }
  jobStore.clear()
}

/** Sidebar / finished project: show full snapshot. */
export function unlockDemoWalkthrough() {
  reveal = { outline: true, sources: true, figures: true, slides: true }
}

function unlockForStep(step) {
  const s = String(step || '')
  if (s === 'generate_outline') reveal.outline = true
  if (s === 'retrieve' || s === 'retrieve_screen' || s === 'confirm_sources') reveal.sources = true
  if (s === 'fill' || s === 'fill_skip_resolved') {
    reveal.figures = true
    reveal.slides = true
  }
  if (s === 'export_slides' || s === 'rerender_export' || s === 'rerender') {
    reveal.figures = true
    reveal.slides = true
  }
  if (s === 'run_default_pipeline' || s === 'draft' || s === 'lecture_script') {
    unlockDemoWalkthrough()
  }
}

function unlockForGate(gate) {
  const g = String(gate || '')
  if (g === 'gate1_outline') reveal.sources = true
  if (g === 'gate2_sources') reveal.figures = true
  if (g === 'gate3_evidence_visual') reveal.slides = true
}

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
    const bust = import.meta.env.VITE_DEMO_BUILD || Date.now()
    packPromise = fetch(`${BASE}showcase/my-ppt/pack.json?v=${bust}`, { cache: 'no-store' })
      .then(async (r) => {
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
      .catch((err) => {
        packPromise = null
        throw err
      })
  }
  return packPromise
}

function okJob(step) {
  const id = `demo-${jobSeq++}`
  const fillOk =
    step === 'fill' || step === 'fill_skip_resolved'
      ? 'generated via bl · bailian=3\n'
      : ''
  return {
    job_id: id,
    project_id: DEMO_PROJECT_ID,
    step,
    status: 'ok',
    returncode: 0,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    log_tail: `[showcase] ${step} · 演示加载已有快照（不跑真实管线）\n${fillOk}`,
    cancel_requested: false,
  }
}

function delay(ms = 200) {
  return new Promise((r) => setTimeout(r, ms))
}

function emptyOutline() {
  return {
    course_title: outline?.course_title || DEMO_COURSE_TITLE,
    audience: outline?.audience || '',
    target_minutes: outline?.target_minutes || 50,
    status: 'draft',
    sections: [],
  }
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
    const artifacts = { ...(p.detail?.artifacts || {}) }
    // While walking, don't advertise a finished deck so resume logic stays on early steps.
    if (!reveal.slides) {
      artifacts['deck/final.pptx'] = false
      artifacts['deck/draft-with-images.pptx'] = false
      artifacts['source/slide_plan.json'] = false
    }
    if (!reveal.figures) artifacts['source/figure_catalog.json'] = false
    if (!reveal.sources) artifacts['source/sources.json'] = false
    if (!reveal.outline) artifacts['source/outline.json'] = false
    return {
      ...p.detail,
      artifacts,
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
    resetDemoWalkthrough()
    await delay(400)
    return { project_id: DEMO_PROJECT_ID, id: DEMO_PROJECT_ID }
  },
  registerUat: async () => ({ ok: true }),
  listMaterials: async () => ({ materials: [] }),
  uploadMaterials: async () => ({ ok: true, count: 0 }),
  getOutline: async () => {
    await ensurePack()
    return reveal.outline ? structuredClone(outline) : emptyOutline()
  },
  putOutline: async (_id, next) => {
    outline = next
    reveal.outline = true
    return outline
  },
  getBrief: async () => ({
    path: 'source/project_brief.md',
    text: '静态展示：真实项目快照（只读浏览）。',
  }),
  putBrief: async () => ({ ok: true }),
  getSources: async () => {
    const p = await ensurePack()
    if (!reveal.sources) {
      return {
        project_id: DEMO_PROJECT_ID,
        sources: [],
        counts: { total: 0, selected: 0, proposed: 0, rejected: 0 },
      }
    }
    return p.sources
  },
  decideSource: async () => {
    const p = await ensurePack()
    reveal.sources = true
    return p.sources
  },
  addManualSource: async () => {
    const p = await ensurePack()
    reveal.sources = true
    return p.sources
  },
  uploadSourcePdfs: async () => ({ ok: true }),
  getFigures: async () => {
    const p = await ensurePack()
    if (!reveal.figures) {
      return { project_id: DEMO_PROJECT_ID, figures: [], counts: { total: 0 } }
    }
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
  listOutlineSnapshots: async () => ({ snapshots: [] }),
  restoreOutlineSnapshot: async () => ({ restored_from: null, count: 0 }),
  getSlides: async () => {
    const p = await ensurePack()
    if (!reveal.slides) {
      return { project_id: DEMO_PROJECT_ID, count: 0, has_exports: false, slides: [] }
    }
    return p.slides
  },
  getQa: async () => {
    const p = await ensurePack()
    return p.qa || { status: 'pass' }
  },
  getLectureScript: async () => {
    await ensurePack()
    return { text: reveal.slides ? lecture : '' }
  },
  putLectureScript: async (_id, text) => {
    lecture = text
    return { ok: true }
  },
  regenerateLecturePage: async () => ({ ok: true }),
  confirmGate: async (_id, gate) => {
    unlockForGate(gate)
    await delay(350)
    return { ok: true }
  },
  startJob: async (_id, step) => {
    await delay(1100)
    unlockForStep(step)
    const j = okJob(step)
    jobStore.set(j.job_id, j)
    return j
  },
  getJob: async (jobId) => {
    const j = jobStore.get(jobId)
    if (j) return j
    return {
      job_id: jobId,
      project_id: DEMO_PROJECT_ID,
      step: 'showcase',
      status: 'ok',
      returncode: 0,
      log_tail: '[showcase] done\n',
    }
  },
  cancelJob: async () => ({ ok: true }),
  listJobs: async () => ({ jobs: [] }),
  downloadUrl: (_id, path) => {
    const rel = String(path || '').replace(/^\/+/, '')
    return assetUrl(`showcase/my-ppt/files/${rel}`)
  },
  packDownloadUrl: () => assetUrl('showcase/my-ppt/files/deck/final.pptx'),
  copilotOutline: async () => ({
    ok: true,
    summary: '展示站为只读快照，副驾未连接。',
    actions: [],
  }),
  copilotStudio: async () => ({
    ok: true,
    summary: '展示站：按真实流程逐步浏览样例课程；检索/生图不会真正执行，结果来自快照。',
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
    await delay(250)
    return { ...themeState, designs: themeState.page_designs }
  },
}
