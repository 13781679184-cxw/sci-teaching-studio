import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { OutlineEditor } from './OutlineEditor.jsx'
import { SourcesTable } from './SourcesTable.jsx'
import { FiguresGallery } from './FiguresGallery.jsx'
import { SlidesPreview } from './SlidesPreview.jsx'
import { StudioCopilot } from './StudioCopilot.jsx'
import { ProvidersModal } from './ProvidersModal.jsx'
import { ThemePicker } from './ThemePicker.jsx'
import {
  IS_DEMO,
  DEMO_PROJECT_ID,
  DEMO_COURSE_TITLE,
  DEMO_AUDIENCE,
  DEMO_MINUTES,
  GITHUB_DECK_SKILL,
  GITHUB_STUDIO_WEB,
} from './demo/mode.js'
import { resetDemoWalkthrough, unlockDemoWalkthrough } from './demo/api.js'

const GATES = [
  { id: 'input', label: '输入', gate: null },
  { id: 'theme', label: '版式', gate: null },
  { id: 'outline', label: '大纲', gate: 'gate1_outline' },
  { id: 'sources', label: '文献', gate: 'gate2_sources' },
  { id: 'figures', label: '配图', gate: 'gate3_evidence_visual' },
  { id: 'complete', label: '完成', gate: null },
]

const SCREEN_ORDER = ['theme', 'outline', 'sources', 'figures', 'complete']
const LAST_SCREEN_KEY = (id) => `sci.studio.lastScreen.${id}`

/** Furthest step the project has reached, based on artifacts / outline status. */
function inferResumeScreen({ detail, outline, sourcesPack, slidesPack }) {
  const a = detail?.artifacts || {}
  const counts = sourcesPack?.counts || {}
  if (
    a['deck/final.pptx'] ||
    a['deck/draft-with-images.pptx'] ||
    a['source/slide_plan.json'] ||
    (slidesPack?.count || 0) > 0
  ) {
    return 'complete'
  }
  if (a['source/figure_catalog.json'] || ((counts.selected || 0) > 0 && outline?.status === 'user_confirmed')) {
    return 'figures'
  }
  if (outline?.status === 'user_confirmed' || a['source/sources.json']) {
    return 'sources'
  }
  if ((outline?.sections || []).length > 0) {
    return 'outline'
  }
  return 'theme'
}

function resolveOpenScreen(projectId, ctx) {
  const furthest = inferResumeScreen(ctx)
  if (furthest === 'complete') return 'complete'
  let saved = null
  try {
    saved = localStorage.getItem(LAST_SCREEN_KEY(projectId))
  } catch {
    /* ignore */
  }
  if (saved === 'preview' || saved === 'deliver') saved = 'complete'
  if (saved === 'pipeline') saved = 'figures'
  if (saved === 'script') saved = 'complete'
  if (!saved || !SCREEN_ORDER.includes(saved)) return furthest
  // Don't jump ahead of progress; prefer last visit if still on/behind furthest
  const si = SCREEN_ORDER.indexOf(saved)
  const fi = SCREEN_ORDER.indexOf(furthest)
  return si <= fi ? saved : furthest
}

const RAIL_STORAGE_KEY = 'sci-studio-rail-w'
const RAIL_DEFAULT = 294
const RAIL_MIN = 220
const RAIL_MAX = 520

function loadRailWidth() {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY)
    if (raw == null) return RAIL_DEFAULT
    const n = Number(raw)
    // migrate previous default 220 → +1/3
    if (n === 220) return RAIL_DEFAULT
    if (Number.isFinite(n) && n >= RAIL_MIN && n <= RAIL_MAX) return Math.round(n)
  } catch {
    /* ignore */
  }
  return RAIL_DEFAULT
}

function Stepper({ index, onSelect, projectReady }) {
  return (
    <nav className="steps" aria-label="流程">
      {GATES.map((g, i) => {
        const locked = g.id !== 'input' && !projectReady
        return (
          <React.Fragment key={g.id}>
            {i > 0 && <span className={'bar' + (i <= index ? ' fill' : '')} />}
            <button
              type="button"
              className={'step' + (i < index ? ' done' : i === index ? ' cur' : '')}
              disabled={locked}
              onClick={() => onSelect?.(g.id)}
            >
              <span className="num">{i < index ? '✓' : i + 1}</span>
              <span className="lb">{g.label}</span>
            </button>
          </React.Fragment>
        )
      })}
    </nav>
  )
}

function useJobPoll(jobId, onDone, onTick) {
  useEffect(() => {
    if (!jobId) return undefined
    let stop = false
    const tick = async () => {
      try {
        const j = await api.getJob(jobId)
        if (stop) return
        onTick?.(j)
        if (j.status === 'ok' || j.status === 'error' || j.status === 'cancelled') {
          onDone(j)
          return
        }
        setTimeout(tick, 1500)
      } catch (e) {
        onDone({ status: 'error', log_tail: String(e) })
      }
    }
    tick()
    return () => {
      stop = true
    }
  }, [jobId, onDone, onTick])
}

export default function App() {
  const [health, setHealth] = useState(null)
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [screen, setScreen] = useState('outline')
  const [outline, setOutline] = useState(null)
  const [sourcesPack, setSourcesPack] = useState(null)
  const [figuresPack, setFiguresPack] = useState(null)
  const [slidesPack, setSlidesPack] = useState(null)
  const [qa, setQa] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(() => IS_DEMO)
  const [form, setForm] = useState(() => ({
    project_id: IS_DEMO ? DEMO_PROJECT_ID : '',
    prompt: IS_DEMO ? DEMO_COURSE_TITLE : '',
    audience: IS_DEMO ? DEMO_AUDIENCE : '研究生一年级',
    target_minutes: IS_DEMO ? DEMO_MINUTES : 50,
    dissemination: 'internal_class',
    theme_id: 'green',
  }))
  const [logOpen, setLogOpen] = useState(false)
  const [providersOpen, setProvidersOpen] = useState(false)
  const [scriptRev, setScriptRev] = useState(0)
  const [pendingFiles, setPendingFiles] = useState([])
  const [focusPageId, setFocusPageId] = useState(null)
  const [railW, setRailW] = useState(loadRailWidth)
  const [railDragging, setRailDragging] = useState(false)
  const fileInputRef = useRef(null)
  const [themes, setThemes] = useState([])
  const [designsByKind, setDesignsByKind] = useState({})
  const [themeId, setThemeId] = useState('green')
  const [pageDesigns, setPageDesigns] = useState({
    title: 'plain',
    agenda: 'list',
    content: 'chapter',
    section: 'big_num',
    thanks: 'centered',
  })
  const [optionalPages, setOptionalPages] = useState({
    section_dividers: false,
    thanks: false,
  })
  const [accent, setAccent] = useState('#2F5D50')
  const [customAccents, setCustomAccents] = useState([])
  const [pendingOutlineGen, setPendingOutlineGen] = useState(false)

  // legacy screens
  useEffect(() => {
    if (screen === 'pipeline') setScreen('figures')
    if (screen === 'script' || screen === 'preview' || screen === 'deliver') setScreen('complete')
  }, [screen])

  useEffect(() => {
    document.documentElement.style.setProperty('--rail', `${railW}px`)
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, String(railW))
    } catch {
      /* ignore */
    }
  }, [railW])

  useEffect(() => {
    if (!railDragging) return undefined
    function onMove(e) {
      const next = Math.min(RAIL_MAX, Math.max(RAIL_MIN, e.clientX))
      setRailW(Math.round(next))
    }
    function onUp() {
      setRailDragging(false)
      document.body.classList.remove('rail-resizing')
    }
    document.body.classList.add('rail-resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('rail-resizing')
    }
  }, [railDragging])

  const showInput = creating || !projectId

  const gateIndex = useMemo(() => {
    if (showInput) return 0
    const i = GATES.findIndex((g) => g.id === screen)
    return Math.max(0, i)
  }, [screen, showInput])

  function openCreate() {
    setCreating(true)
    setScreen('input')
    setError('')
    setPendingFiles([])
  }

  function cancelCreate() {
    setCreating(false)
    setPendingFiles([])
    if (projectId) setScreen('outline')
  }

  function onPickFiles(e) {
    const list = Array.from(e.target.files || [])
    e.target.value = ''
    if (!list.length) return
    setPendingFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      const next = [...prev]
      for (const f of list) {
        if (!names.has(f.name)) next.push(f)
      }
      return next.slice(0, 12)
    })
  }

  function removePendingFile(name) {
    setPendingFiles((prev) => prev.filter((f) => f.name !== name))
  }

  async function refreshSlides() {
    if (!projectId) return
    try {
      setSlidesPack(await api.getSlides(projectId))
    } catch {
      setSlidesPack(null)
    }
  }

  const refreshProjects = useCallback(async () => {
    const data = await api.listProjects()
    setProjects(data.projects || [])
  }, [])

  const loadProject = useCallback(async (id, { resetScreen = true, demoWalk = false } = {}) => {
    setError('')
    setCreating(false)
    setProjectId(id)
    // Opening from the project list shows the full snapshot; walkthrough must not unlock early.
    if (IS_DEMO && resetScreen && !demoWalk) unlockDemoWalkthrough()
    const d = await api.getProject(id)
    setDetail(d)
    setThemeId(d.theme_id || 'green')
    setAccent(d.theme?.accent || '#2F5D50')
    setCustomAccents(d.custom_accents || [])
    try {
      const th = await api.getTheme(id)
      setThemeId(th.theme_id || d.theme_id || 'green')
      setAccent(th.accent || th.theme?.accent || '#2F5D50')
      setCustomAccents(th.custom_accents || [])
      if (th.designs) setPageDesigns((prev) => ({ ...prev, ...th.designs }))
      if (th.optional_pages) setOptionalPages((prev) => ({ ...prev, ...th.optional_pages }))
      if (th.themes?.length) setThemes(th.themes)
      if (th.designs_catalog) setDesignsByKind(th.designs_catalog)
    } catch {
      /* keep defaults from detail */
    }
    let nextOutline = null
    let nextSources = null
    let nextFigures = null
    let nextSlides = null
    try {
      nextOutline = await api.getOutline(id)
      setOutline(nextOutline)
    } catch {
      setOutline(null)
    }
    try {
      nextSources = await api.getSources(id)
      setSourcesPack(nextSources)
    } catch {
      setSourcesPack(null)
    }
    try {
      nextFigures = await api.getFigures(id)
      setFiguresPack(nextFigures)
    } catch {
      setFiguresPack(null)
    }
    try {
      nextSlides = await api.getSlides(id)
      setSlidesPack(nextSlides)
    } catch {
      setSlidesPack(null)
    }
    try {
      setQa(await api.getQa(id))
    } catch {
      setQa(null)
    }
    if (resetScreen) {
      setScreen(
        resolveOpenScreen(id, {
          detail: d,
          outline: nextOutline,
          sourcesPack: nextSources,
          slidesPack: nextSlides,
        }),
      )
    }
  }, [])

  // Remember last screen per project
  useEffect(() => {
    if (!projectId || showInput || creating) return
    if (!SCREEN_ORDER.includes(screen)) return
    try {
      localStorage.setItem(LAST_SCREEN_KEY(projectId), screen)
    } catch {
      /* ignore */
    }
  }, [projectId, screen, showInput, creating])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const h = await api.health()
        if (cancelled) return
        setHealth(h)
        if (!h?.ok) {
          setError('API 未就绪：后端 /health 异常。请确认本机 API（默认 :2025）已启动，并与前端代理连通。')
        }
        await refreshProjects()
        const t = await api.listThemes()
        if (cancelled) return
        setThemes(t.themes || [])
        if (t.designs) setDesignsByKind(t.designs)
        if (t.default_designs) setPageDesigns((prev) => ({ ...prev, ...t.default_designs }))
        if (t.default) {
          setForm((f) => ({ ...f, theme_id: f.theme_id || t.default }))
        }
        if (IS_DEMO) {
          // Public demo: land on create home (prefilled), not the finished deck.
          setCreating(true)
          setScreen('input')
        }
      } catch (e) {
        if (!cancelled) {
          setHealth(null)
          setError(
            `API 未连接：${e.message || e}。请先启动后端（uvicorn :2025），再刷新 http://127.0.0.1:5180/。`,
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // demo bootstrap once; loadProject/refreshProjects are stable enough for mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onJobDone = useCallback(
    async (j) => {
      setJob(j)
      setJobId(null)
      setBusy(false)
      // 刷新数据但不要把用户踢回大纲页
      if (projectId) await loadProject(projectId, { resetScreen: false })
      await refreshProjects()
      if (j?.status === 'ok') setLogOpen(false)
      if (j?.status === 'cancelled') {
        setError('已停止当前任务')
        setLogOpen(true)
      }
      if (j?.status === 'error') {
        setLogOpen(true)
        const tail = j.log_tail || ''
        const gate2 = /Gate 2 incomplete|sources still proposed/i.test(tail)
        if (gate2) {
          const ids = (tail.match(/proposed:\s*([S0-9,\s]+)/i) || [])[1]
          const tip =
            '配图失败：还有文献未确认（仍为「待确认」）' +
            (ids ? `：${ids.trim().replace(/\s+/g, '')}` : '') +
            '。请先到「文献」页点「全部选用」或逐条「选用」，再回来跑配图。'
          setError(tip)
          if (window.confirm(`${tip}\n\n现在去文献页？`)) {
            setScreen('sources')
          }
        }
      }
      if (j?.status === 'ok' && (j.step === 'run_default_pipeline' || j.step === 'draft')) {
        setScreen('complete')
      }
      if (j?.status === 'ok' && j.step === 'lecture_script') {
        setScriptRev((n) => n + 1)
        try {
          setSlidesPack(await api.getSlides(projectId))
          setDetail(await api.getProject(projectId))
        } catch {
          /* ignore */
        }
      }
      // 配图重跑成功且确实生出新图后，后台导出页图；留在当前页（配图/预览），不要强跳
      if (
        j?.status === 'ok' &&
        (j.step === 'fill' || j.step === 'fill_skip_resolved') &&
        projectId
      ) {
        const tail = j.log_tail || ''
        const genOk = /generated via bl|bailian=[1-9]/i.test(tail)
        const freeTier =
          /FreeTiersOnly|Free quota exhausted|use free tier only|免费额度/i.test(tail)
        const netFail = /Connect Timeout|UND_ERR_CONNECT|ECONNREFUSED|ETIMEDOUT/i.test(tail)
        const genFail =
          (/ERROR bailian|bailian unavailable|bailian=0/i.test(tail) || freeTier || netFail) &&
          !genOk
        // 口述只作用于当次生成：无论成败都恢复默认 prompt（历史仍保留可点选）
        api.clearFigurePrompt(projectId, { allPages: true }).catch(() => null)
        if (genFail) {
          if (freeTier) {
            setError(
              'AI 生图失败：百炼「仅免费额度」已用尽（AllocationQuota.FreeTiersOnly）。' +
                '请到百炼控制台关闭「仅使用免费额度」，或给账号充值后重试。',
            )
          } else if (netFail) {
            setError('AI 生图失败：连不上百炼服务器（网络/超时）。请检查网络后重试。')
          } else {
            setError(
              'AI 生图失败，已尽量保留原图。请查看下方日志；常见原因：免费额度用尽或网络超时。',
            )
          }
          return
        }
        try {
          setBusy(true)
          setError('')
          const ex = await api.startJob(projectId, 'export_slides', {
            pptx: 'draft-with-images.pptx',
          })
          setJobId(ex.job_id)
          setJob(ex)
        } catch {
          setBusy(false)
        }
      }
    },
    [loadProject, projectId, refreshProjects],
  )
  const onJobTick = useCallback((j) => {
    setJob(j)
  }, [])
  useJobPoll(jobId, onJobDone, onJobTick)

  async function runStep(step, extra = {}) {
    if (!projectId) return
    setBusy(true)
    setError('')
    setJob(null)
    setLogOpen(true)
    try {
      const j = await api.startJob(projectId, step, extra)
      setJobId(j.job_id)
      setJob(j)
    } catch (e) {
      setBusy(false)
      setError(String(e.message || e))
    }
  }

  async function stopJob() {
    if (!jobId && !job?.job_id) {
      setBusy(false)
      setJobId(null)
      return
    }
    const id = jobId || job.job_id
    try {
      const j = await api.cancelJob(id)
      setJob(j)
      setJobId(null)
      setBusy(false)
      setError('已停止当前任务')
      setLogOpen(true)
      if (projectId) await loadProject(projectId, { resetScreen: false })
    } catch (e) {
      // 即使后端取消失败，也先解锁 UI（进程可能已挂）
      setJobId(null)
      setBusy(false)
      setError(`停止失败：${e.message || e}（已解除界面锁定）`)
    }
  }

  async function confirmCurrent() {
    const g = GATES.find((x) => x.id === screen)
    if (!projectId || !g?.gate) return
    setBusy(true)
    setError('')
    try {
      const body =
        g.gate === 'gate1_outline'
          ? { user_choice: '确认大纲', outline_status: 'user_confirmed' }
          : { user_choice: '确认' }
      await api.confirmGate(projectId, g.gate, body)
      await loadProject(projectId, { resetScreen: false })
      if (g.id === 'outline') setScreen('sources')
      else if (g.id === 'sources') setScreen('figures')
      else if (g.id === 'figures') setScreen('complete')
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function saveOutline(next) {
    setBusy(true)
    setError('')
    try {
      await api.putOutline(projectId, next)
      await loadProject(projectId, { resetScreen: false })
    } catch (e) {
      setError(String(e.message || e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  async function decideSource(sourceId, decision) {
    setBusy(true)
    setError('')
    try {
      await api.decideSource(projectId, sourceId, decision)
      setSourcesPack(await api.getSources(projectId))
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function createProject(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const id = form.project_id
      if (IS_DEMO) resetDemoWalkthrough()
      await api.createProject({
        project_id: id,
        prompt: form.prompt,
        audience: form.audience,
        target_minutes: Number(form.target_minutes) || 50,
        dissemination: form.dissemination,
        theme_id: form.theme_id || 'green',
      })
      if (pendingFiles.length) {
        await api.uploadMaterials(id, pendingFiles)
        setPendingFiles([])
      }
      await refreshProjects()
      const loadId = IS_DEMO ? DEMO_PROJECT_ID : id
      await loadProject(loadId, { resetScreen: false, demoWalk: IS_DEMO })
      setCreating(false)
      setPendingOutlineGen(true)
      setScreen('theme')
      try {
        localStorage.removeItem(LAST_SCREEN_KEY(loadId))
      } catch {
        /* ignore */
      }
      setBusy(false)
    } catch (err) {
      setBusy(false)
      setError(String(err.message || err))
    }
  }

  async function confirmThemeAndContinue() {
    if (!projectId) return
    setBusy(true)
    setError('')
    try {
      await api.putTheme(projectId, {
        theme_id: themeId || form.theme_id || 'green',
        accent: accent || undefined,
        designs: pageDesigns,
        optional_pages: optionalPages,
        custom_accents: customAccents,
      })
      const hasPlan = Boolean(detail?.artifacts?.['source/slide_plan.json'])
      const hasPpt = Boolean(
        detail?.artifacts?.['deck/draft-with-images.pptx'] ||
          detail?.artifacts?.['deck/final.pptx'] ||
          detail?.artifacts?.['deck/draft.pptx'],
      )
      // Always advance to outline after theme confirm (写入或重渲都是手段，下一步是大纲).
      if (pendingOutlineGen) {
        setPendingOutlineGen(false)
        setScreen('outline')
        const j = await api.startJob(projectId, 'generate_outline')
        setJobId(j.job_id)
        setJob(j)
        setLogOpen(true)
        return
      }
      setScreen('outline')
      if (hasPlan || hasPpt) {
        await runStep('rerender_export', {
          pptx: 'draft-with-images.pptx',
        })
        return
      }
      setBusy(false)
    } catch (err) {
      setBusy(false)
      setError(String(err.message || err))
    }
  }

  function draftTheme(id) {
    const t = themes.find((x) => x.id === id)
    setThemeId(id)
    setForm((f) => ({ ...f, theme_id: id }))
    if (t?.accent) setAccent(t.accent)
  }

  function draftDesign(kind, designId) {
    setPageDesigns((prev) => ({ ...prev, [kind]: designId }))
  }

  function draftAccent(hex) {
    setAccent(hex)
    setThemeId('custom')
    setForm((f) => ({ ...f, theme_id: 'custom' }))
  }

  function draftCustomAccent(hex) {
    const h = String(hex || '').trim()
    if (!/^#[0-9A-Fa-f]{6}$/i.test(h)) return
    const next = [h, ...customAccents.filter((c) => String(c).toUpperCase() !== h.toUpperCase())].slice(
      0,
      12,
    )
    setCustomAccents(next)
    draftAccent(h)
  }

  function draftOptionalPages(next) {
    setOptionalPages(next)
  }

  async function persistTheme(patch, { rerender = false } = {}) {
    if (!projectId) {
      if (patch.theme_id) {
        setForm((f) => ({ ...f, theme_id: patch.theme_id }))
        setThemeId(patch.theme_id)
      }
      if (patch.designs) setPageDesigns((prev) => ({ ...prev, ...patch.designs }))
      if (patch.optional_pages) setOptionalPages((prev) => ({ ...prev, ...patch.optional_pages }))
      if (patch.accent) setAccent(patch.accent)
      if (patch.custom_accents) setCustomAccents(patch.custom_accents)
      return
    }
    try {
      const r = await api.putTheme(projectId, patch)
      const th = r.theme || {}
      setThemeId(th.theme_id || patch.theme_id || themeId)
      if (th.designs) setPageDesigns((prev) => ({ ...prev, ...th.designs }))
      if (th.optional_pages) setOptionalPages((prev) => ({ ...prev, ...th.optional_pages }))
      setAccent(th.accent || patch.accent || accent)
      if (Array.isArray(th.custom_accents)) setCustomAccents(th.custom_accents)
      setForm((f) => ({ ...f, theme_id: th.theme_id || f.theme_id }))
      setDetail((d) =>
        d
          ? {
              ...d,
              theme_id: th.theme_id || d.theme_id,
              theme: {
                ...(d.theme || {}),
                id: th.theme_id,
                accent: th.accent,
                board: th.board,
                name: th.name,
              },
              custom_accents: th.custom_accents || d.custom_accents,
            }
          : d,
      )
      if (r.optional_sync?.ok) {
        try {
          setSlidesPack(await api.getSlides(projectId))
        } catch {
          /* ignore */
        }
      }
      if (
        rerender &&
        (detail?.artifacts?.['source/slide_plan.json'] ||
          detail?.artifacts?.['deck/draft-with-images.pptx'])
      ) {
        await runStep('rerender_export', { pptx: 'draft-with-images.pptx' })
      }
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  const jobStatus = job?.status || (jobId ? 'running' : '')
  const jobTone =
    jobStatus === 'ok'
      ? 'ok'
      : jobStatus === 'error'
        ? 'err'
        : jobStatus === 'cancelled'
          ? ''
          : jobStatus
            ? 'warn'
            : ''
  const STEP_ZH = {
    generate_outline: '生成大纲',
    retrieve_screen: '检索并初筛',
    retrieve: '检索',
    screen: '初筛',
    confirm_sources: '采纳文献',
    run_default_pipeline: '一键配图',
    crop: '裁图',
    fill: '补图',
    fill_skip_resolved: '继续生图',
    export_slides: '导出预览',
    rerender: '重渲 PPT',
    rerender_export: '重渲或刷新预览',
    lecture_script: '生成讲稿',
    deliver: '定稿',
  }
  const jobLabel = STEP_ZH[job?.step] || job?.step || '任务'
  const jobStatusZh =
    jobStatus === 'ok'
      ? '完成'
      : jobStatus === 'error'
        ? '失败'
        : jobStatus === 'cancelled'
          ? '已停止'
          : jobStatus === 'running' || jobStatus === 'queued'
            ? '副驾正在努力中ing'
            : jobStatus
  const logText =
    (job?.log_tail || '').trim() ||
    (jobStatus === 'running' || jobStatus === 'queued'
      ? '副驾正在努力中ing…\n日志马上出来。'
      : '')

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          Sci Teaching <span>Studio</span>
        </div>
        <Stepper
          index={Math.max(0, gateIndex)}
          projectReady={Boolean(projectId)}
          onSelect={(id) => {
            if (id === 'input') {
              openCreate()
              return
            }
            if (!projectId) return
            setCreating(false)
            setScreen(id)
          }}
        />
        <div className="top-meta">
          <button
            type="button"
            className="btn ghost sm"
            title="模型能力 / API"
            onClick={() => setProvidersOpen(true)}
          >
            模型能力
          </button>
          {busy && (
            <>
              <span className="top-busy">
                {job?.step === 'export_slides' || job?.step === 'rerender_export' || job?.step === 'rerender'
                  ? '导出预览中…'
                  : '副驾正在努力中ing'}
              </span>
              <button type="button" className="btn sm danger top-stop" onClick={stopJob}>
                停止
              </button>
            </>
          )}
          <span className={'dot' + (health ? ' on' : '')} title={health ? 'API 正常' : 'API 未就绪'} />
        </div>
      </header>

      {IS_DEMO && (
        <div className="demo-banner" role="status">
          <strong>公开展示站</strong>
          <span>
            · 固定真实项目快照（界面与本机一致；配图/预览为真实导出图）。检索与生图为只读演示。
          </span>
        </div>
      )}

      {error && (
        <div className="app-err-banner" role="alert">
          <span className="app-err-banner-text">{error}</span>
          <button type="button" className="btn sm ghost" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      )}

      {providersOpen && <ProvidersModal onClose={() => setProvidersOpen(false)} />}

      <div className="main" style={{ gridTemplateColumns: `${railW}px minmax(0, 1fr)` }}>
        <aside className="rail">
          <div
            className={'rail-resizer' + (railDragging ? ' is-dragging' : '')}
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={railW}
            aria-valuemin={RAIL_MIN}
            aria-valuemax={RAIL_MAX}
            title="拖拽调整侧栏宽度"
            onMouseDown={(e) => {
              e.preventDefault()
              setRailDragging(true)
            }}
          />
          <div className="demo-rail-repos" aria-label="开源仓库">
            <div className="demo-rail-repo-line">
              <span>内核 Skill：</span>
              <a href={GITHUB_DECK_SKILL} target="_blank" rel="noreferrer">
                sci-teaching-deck
              </a>
            </div>
            <div className="demo-rail-repo-line">
              <span>完整源码：</span>
              <a href={GITHUB_STUDIO_WEB} target="_blank" rel="noreferrer">
                sci-teaching-studio
              </a>
            </div>
          </div>
          <div className="rail-head">
            <span>项目</span>
            <button
              type="button"
              className={'btn ghost sm' + (showInput && creating ? ' on' : '')}
              onClick={() => (showInput && creating && projectId ? cancelCreate() : openCreate())}
            >
              {showInput && creating && projectId ? '收起' : '新建'}
            </button>
          </div>

          <div className="list">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={'item' + (p.id === projectId && !showInput ? ' active' : '')}
                onClick={() => loadProject(p.id)}
              >
                <div className="t">{p.course_title || p.id}</div>
                <div className="s">
                  {p.id}
                  {p.has_final ? ' · final' : ''}
                </div>
              </button>
            ))}
            {!projects.length && <p className="muted rail-empty">还没有项目</p>}
          </div>

          {projectId && !showInput && (
            <StudioCopilot
              screen={screen}
              projectId={projectId}
              pageId={focusPageId}
              busy={busy}
              onOutline={(o) => {
                setOutline(o)
              }}
              onRunStep={runStep}
              onRefresh={() => {
                if (projectId) loadProject(projectId, { resetScreen: false })
              }}
              onLecture={() => setScriptRev((n) => n + 1)}
            />
          )}
        </aside>

        <section className={'stage' + (showInput ? ' create-mode' : '')}>
          {showInput ? (
            <div className="create-hero">
              <form className="create-hero-inner" onSubmit={createProject}>
                <h1>想讲点什么？</h1>
                <p className="lead">
                  {IS_DEMO
                    ? `这页只演示一门课：《${DEMO_COURSE_TITLE}》。题目和代号已填好——点「开始生成」，再顺着顶栏走版式、大纲、文献、配图，每一步都会载入事先做好的成品。`
                    : '写下一题或一段说明，会先生成大纲，再走文献、配图与讲稿。'}
                </p>

                <div className="create-card">
                  <textarea
                    required
                    autoFocus
                    value={form.prompt}
                    onChange={(e) => {
                      const prompt = e.target.value
                      setForm((f) => {
                        const next = { ...f, prompt }
                        // 有题目且代号仍空时，自动给一个合法代号，避免按钮灰掉却无提示
                        if (prompt.trim() && !String(f.project_id || '').trim()) {
                          next.project_id = `deck-${Date.now().toString(36)}`
                        }
                        return next
                      })
                    }}
                    placeholder="例如：小分子药物设计的关键技术 —— 给生物/药学本科生的 50 分钟课"
                  />
                  {pendingFiles.length > 0 && (
                    <ul className="create-files">
                      {pendingFiles.map((f) => (
                        <li key={f.name}>
                          <span>{f.name}</span>
                          <button type="button" className="btn ghost sm" onClick={() => removePendingFile(f.name)}>
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="create-card-foot">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      hidden
                      accept=".pdf,.md,.txt,.markdown,.csv,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif"
                      onChange={onPickFiles}
                    />
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      + 上传资料
                    </button>
                    <button
                      className="btn primary"
                      type="submit"
                      disabled={busy || !form.prompt.trim() || !form.project_id.trim()}
                      title={
                        !form.prompt.trim()
                          ? '请先填写要讲的题目'
                          : !form.project_id.trim()
                            ? '请填写下方项目代号'
                            : undefined
                      }
                    >
                      开始生成 →
                    </button>
                  </div>
                  {form.prompt.trim() && !form.project_id.trim() ? (
                    <p className="create-need">请填写下方「代号」后再开始（英文/数字/下划线）。</p>
                  ) : null}
                </div>

                <div className="create-meta">
                  <label>
                    <span className="create-meta-label">
                      代号 <em className="req-mark">必填</em>
                    </span>
                    <input
                      required
                      value={form.project_id}
                      onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                      placeholder="my-deck-01"
                      pattern="^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$"
                      title="以字母或数字开头，仅英文、数字、_、-"
                    />
                  </label>
                  <label>
                    <span className="create-meta-label">
                      受众 <em className="opt-mark">可选</em>
                    </span>
                    <input
                      value={form.audience}
                      onChange={(e) => setForm({ ...form, audience: e.target.value })}
                      placeholder="如：研究生一年级"
                    />
                  </label>
                  <label>
                    <span className="create-meta-label">
                      分钟 <em className="opt-mark">可选</em>
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={form.target_minutes}
                      onChange={(e) => setForm({ ...form, target_minutes: e.target.value })}
                    />
                  </label>
                </div>
                <p className="create-meta-hint">
                  代号用于文件夹名，须为英文/数字；受众与课时有默认值，可按需改。
                </p>

                {projectId && (
                  <button type="button" className="btn ghost create-cancel" onClick={cancelCreate}>
                    取消，回到当前项目
                  </button>
                )}
              </form>
            </div>
          ) : (
            <>
              <div className="stage-head">
                <h1>{detail?.course_title || projectId || '选择或新建项目'}</h1>
              </div>

              <div className="stage-body">
          {projectId && screen === 'theme' && (
            <div className="theme-step">
              <div className="toolbar">
                <div className="toolbar-meta">
                  版式 · 先选设计，点<strong>确定</strong>后写入或重渲，并进入大纲
                </div>
                <div className="toolbar-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={confirmThemeAndContinue}
                  >
                    {pendingOutlineGen ? '确定，生成大纲 →' : '确定并应用 →'}
                  </button>
                </div>
              </div>
              <ThemePicker
                themes={themes}
                designsByKind={designsByKind}
                value={themeId}
                designs={pageDesigns}
                accent={accent}
                customAccents={customAccents}
                optionalPages={optionalPages}
                onChangeTheme={draftTheme}
                onChangeDesign={draftDesign}
                onChangeAccent={draftAccent}
                onAddCustomAccent={draftCustomAccent}
                onChangeOptional={draftOptionalPages}
              />
              <p className="theme-hint">
                点选只改预览选中态；点「确定并应用 →」会写入或重渲，并进入大纲页
                {detail?.artifacts?.['source/slide_plan.json'] ? '（已有幻灯片时后台重渲）' : ''}
                。
              </p>
            </div>
          )}

          {projectId && screen === 'outline' && (
            <OutlineEditor
              outline={outline}
              onChange={setOutline}
              onSave={saveOutline}
              onConfirm={confirmCurrent}
              onGenerate={() => runStep('generate_outline')}
              projectId={projectId}
              busy={busy}
            />
          )}

          {projectId && screen === 'sources' && (
            <SourcesTable
              projectId={projectId}
              sources={sourcesPack?.sources}
              counts={sourcesPack?.counts}
              onDecide={decideSource}
              onRun={runStep}
              onNext={confirmCurrent}
              onSourcesChange={async () => {
                try {
                  setSourcesPack(await api.getSources(projectId))
                } catch {
                  setSourcesPack(null)
                }
              }}
              busy={busy}
            />
          )}

          {projectId && screen === 'figures' && (
            <FiguresGallery
              projectId={projectId}
              figures={figuresPack?.figures}
              counts={figuresPack?.counts}
              onRun={runStep}
              onGoPreview={confirmCurrent}
              onGoSources={() => setScreen('sources')}
              proposedCount={sourcesPack?.counts?.proposed ?? 0}
              onFiguresChange={async () => {
                try {
                  setFiguresPack(await api.getFigures(projectId))
                  setSlidesPack(await api.getSlides(projectId))
                } catch {
                  /* ignore */
                }
              }}
              busy={busy}
              job={job}
            />
          )}

          {projectId && screen === 'complete' && (
            <SlidesPreview
              projectId={projectId}
              pack={slidesPack}
              onRun={runStep}
              onRefresh={refreshSlides}
              onFocusPage={setFocusPageId}
              busy={busy}
              hasFinal={Boolean(detail?.artifacts?.['deck/final.pptx'])}
              hasDraft={Boolean(detail?.artifacts?.['deck/draft-with-images.pptx'])}
              scriptRev={scriptRev}
              downloadActions={
                <>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => {
                      setPendingOutlineGen(false)
                      setScreen('theme')
                    }}
                    title="返回修改强调色与页种版式"
                  >
                    修改版式
                  </button>
                  {!detail?.artifacts?.['deck/final.pptx'] &&
                    (detail?.artifacts?.['deck/draft-with-images.pptx'] ||
                      detail?.artifacts?.['source/slide_plan.json']) && (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy}
                        onClick={() => runStep('deliver')}
                        title="生成 final.pptx"
                      >
                        生成终稿
                      </button>
                    )}
                  {detail?.artifacts?.['deck/final.pptx'] ? (
                    <a className="btn sm" href={api.downloadUrl(projectId, 'deck/final.pptx')}>
                      下载 PPT
                    </a>
                  ) : detail?.artifacts?.['deck/draft-with-images.pptx'] ? (
                    <a
                      className="btn sm"
                      href={api.downloadUrl(projectId, 'deck/draft-with-images.pptx')}
                    >
                      下载 PPT
                    </a>
                  ) : null}
                  {detail?.artifacts?.['lecture_script.md'] ? (
                    <a className="btn sm" href={api.downloadUrl(projectId, 'lecture_script.md')}>
                      下载讲稿
                    </a>
                  ) : null}
                  {(detail?.artifacts?.['deck/final.pptx'] ||
                    detail?.artifacts?.['deck/draft-with-images.pptx']) &&
                    detail?.artifacts?.['lecture_script.md'] && (
                      <a className="btn sm primary" href={api.packDownloadUrl(projectId)} download>
                        打包下载
                      </a>
                    )}
                </>
              }
            />
          )}

          {(job || jobId) && (
            <div className="job-dock" id="job-log">
              <div className="job-dock-bar">
                <button type="button" className="job-toggle" onClick={() => setLogOpen((v) => !v)}>
                  <span className={'pill' + (jobTone ? ` ${jobTone}` : '')}>
                    {jobLabel} · {jobStatusZh || '…'}
                  </span>
                  <span className="muted">{logOpen ? '收起' : '日志'}</span>
                </button>
                {busy && (
                  <button type="button" className="btn sm danger" onClick={stopJob}>
                    停止
                  </button>
                )}
              </div>
              {logOpen && <pre className="log">{logText || '暂无日志'}</pre>}
            </div>
          )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
