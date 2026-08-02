import { IS_DEMO, DEMO_PROJECT_ID } from './mode.js'
import {
  DEMO_FIGURES,
  DEMO_HEALTH,
  DEMO_LECTURE,
  DEMO_OUTLINE,
  DEMO_PROJECT,
  DEMO_PROVIDERS,
  DEMO_QA,
  DEMO_SLIDES,
  DEMO_SOURCES,
  DEMO_THEMES,
} from './data.js'

let outline = structuredClone(DEMO_OUTLINE)
let themeState = {
  theme_id: 'green',
  accent: '#2F5D50',
  page_designs: { ...DEMO_PROJECT.page_designs },
  optional_pages: { ...DEMO_PROJECT.optional_pages },
}
let lecture = DEMO_LECTURE
let jobSeq = 1

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
    log_tail: `[demo] ${step} · 演示模式：未调用真实管线\n`,
    cancel_requested: false,
  }
}

function delay(ms = 280) {
  return new Promise((r) => setTimeout(r, ms))
}

export const demoApi = {
  health: async () => DEMO_HEALTH,
  listProjects: async () => ({
    projects: [
      {
        id: DEMO_PROJECT_ID,
        course_title: DEMO_PROJECT.course_title,
        audience: DEMO_PROJECT.audience,
        updated_at: DEMO_OUTLINE.updated_at,
      },
    ],
  }),
  getProject: async () => ({
    ...DEMO_PROJECT,
    theme_id: themeState.theme_id,
    theme: {
      id: themeState.theme_id,
      name: DEMO_THEMES.themes.find((t) => t.id === themeState.theme_id)?.name || '自定义',
      accent: themeState.accent,
      board: 'white',
    },
    page_designs: themeState.page_designs,
    optional_pages: themeState.optional_pages,
  }),
  createProject: async () => {
    await delay()
    return { project_id: DEMO_PROJECT_ID, id: DEMO_PROJECT_ID }
  },
  registerUat: async () => ({ ok: true }),
  listMaterials: async () => ({ materials: [] }),
  uploadMaterials: async () => ({ ok: true, count: 0 }),
  getOutline: async () => outline,
  putOutline: async (_id, next) => {
    outline = next
    return outline
  },
  getBrief: async () => ({
    path: 'source/project_brief.md',
    text: '演示简报：Wnt/β-catenin 教学课（静态样例）。',
  }),
  putBrief: async () => ({ ok: true }),
  getSources: async () => DEMO_SOURCES,
  decideSource: async () => DEMO_SOURCES,
  addManualSource: async () => DEMO_SOURCES,
  uploadSourcePdfs: async () => ({ ok: true }),
  getFigures: async () => DEMO_FIGURES,
  deleteFigure: async () => ({ ok: true }),
  translateFigureCaption: async (_id, figureId) => {
    const f = DEMO_FIGURES.figures.find((x) => x.figure_id === figureId)
    return { caption_zh: f?.caption_zh || f?.caption || '' }
  },
  listVisualSnapshots: async () => ({ snapshots: [] }),
  restoreVisualSnapshot: async () => ({ restored_from: null, count: 0 }),
  getSlides: async () => DEMO_SLIDES,
  getQa: async () => DEMO_QA,
  getLectureScript: async () => ({ text: lecture }),
  putLectureScript: async (_id, text) => {
    lecture = text
    return { ok: true }
  },
  regenerateLecturePage: async () => ({ ok: true }),
  confirmGate: async () => ({ ok: true }),
  startJob: async (_id, step) => {
    await delay(400)
    return okJob(step)
  },
  getJob: async (jobId) => ({
    job_id: jobId,
    project_id: DEMO_PROJECT_ID,
    step: 'demo',
    status: 'ok',
    returncode: 0,
    log_tail: '[demo] done\n',
  }),
  cancelJob: async () => ({ ok: true }),
  listJobs: async () => ({ jobs: [] }),
  downloadUrl: () => '#',
  packDownloadUrl: () => '#',
  copilotOutline: async () => ({
    ok: true,
    summary: '演示模式：副驾未连接真实模型。',
    actions: [],
  }),
  copilotStudio: async () => ({
    ok: true,
    summary: '演示模式：可浏览界面与样例数据，生成类操作不会真正执行。',
    actions: [],
  }),
  copilotFigure: async () => ({ ok: true, prompt_history: [] }),
  figurePromptHistory: async () => ({ history: [] }),
  clearFigurePrompt: async () => ({ ok: true }),
  listThemes: async () => DEMO_THEMES,
  getTheme: async () => ({
    ...themeState,
    designs: themeState.page_designs,
    theme: {
      id: themeState.theme_id,
      accent: themeState.accent,
      board: 'white',
    },
  }),
  putTheme: async (_id, payload) => {
    const p = typeof payload === 'string' ? { theme_id: payload } : payload || {}
    if (p.theme_id) themeState.theme_id = p.theme_id
    if (p.accent) themeState.accent = p.accent
    if (p.page_designs) themeState.page_designs = { ...themeState.page_designs, ...p.page_designs }
    if (p.optional_pages) themeState.optional_pages = { ...themeState.optional_pages, ...p.optional_pages }
    await delay(200)
    return themeState
  },
}

export { IS_DEMO, DEMO_PROJECT_ID, DEMO_PROVIDERS }
