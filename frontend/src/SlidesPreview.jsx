import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

const ROLE_ZH = {
  title: '封面',
  agenda: '议程',
  content: '内容',
  summary: '小结',
  references: '参考文献',
  section: '章节',
}

const NO_FIG_ROLES = new Set(['title', 'agenda', 'section', 'summary', 'references', 'thanks'])

function roleLabel(role) {
  return ROLE_ZH[role] || role || '页'
}

/** Normalize P1 / P01 → P01 style key matching slide_plan when possible. */
function normPageId(id) {
  const m = String(id || '').trim().match(/^P0*(\d+)$/i)
  if (!m) return String(id || '').trim().toUpperCase()
  return `P${String(Number(m[1])).padStart(2, '0')}`
}

/**
 * Parse lecture_script.md sections headed by `## P01 Title`.
 * Returns { preamble, byPage: { P01: { title, body } } }.
 */
export function parseLectureScript(md) {
  const text = String(md || '')
  const byPage = {}
  const re = /^##\s+(P\d+)\s*(.*?)\s*$/gim
  const hits = []
  let m
  while ((m = re.exec(text))) {
    hits.push({ id: normPageId(m[1]), title: (m[2] || '').trim(), start: m.index, headEnd: m.index + m[0].length })
  }
  if (!hits.length) {
    return { preamble: text.trim(), byPage }
  }
  const preamble = text.slice(0, hits[0].start).trim()
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length
    let body = text.slice(hits[i].headEnd, end).trim()
    body = body.replace(/^\s*---\s*$/gm, '').trim()
    byPage[hits[i].id] = { title: hits[i].title, body }
  }
  return { preamble, byPage }
}

/** Rebuild full markdown from preamble + ordered slides + byPage bodies. */
export function buildLectureScript(preamble, slides, byPage) {
  const parts = []
  const pre = (preamble || '').trim()
  if (pre) {
    parts.push(pre)
    parts.push('')
    parts.push('---')
    parts.push('')
  } else {
    parts.push('# 配套讲稿（lecture_script）', '', '---', '')
  }
  for (const s of slides || []) {
    const pid = normPageId(s.page_id)
    const entry = byPage[pid] || {}
    const title = entry.title || s.page_title || ''
    const body = (entry.body || '').trim()
    parts.push(`## ${pid} ${title}`.trim())
    parts.push('')
    parts.push(body || '_（本页暂无口播）_')
    parts.push('')
    parts.push('---')
    parts.push('')
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** 16:9 PPT 画布：标题 + 要点 + 配图（无整页截图时的近似预览） */
function PptSlide({ slide, pageNo, total }) {
  const role = slide.page_role
  const isCover = role === 'title'
  const isSection = role === 'section' || role === 'agenda'
  const fig = slide.export_thumb_url || slide.figure_thumb_url
  const bullets = slide.on_slide_text || []
  const showFig = Boolean(fig) && !isCover

  return (
    <div
      className={
        'ppt-slide' +
        (isCover ? ' is-cover' : '') +
        (isSection ? ' is-section' : '') +
        (showFig ? ' has-fig' : '')
      }
    >
      <div className="ppt-slide-pad">
        <div className="ppt-kicker">
          {roleLabel(role)} · {pageNo}/{total}
        </div>
        <h3 className="ppt-title">{slide.page_title || slide.page_id}</h3>
        {!isCover && (
          <div className="ppt-body">
            <ul className="ppt-bullets">
              {bullets.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
              {!bullets.length && <li className="muted">（本页无要点文案）</li>}
            </ul>
            {showFig && (
              <div className="ppt-fig">
                <img src={fig} alt="" draggable={false} />
              </div>
            )}
          </div>
        )}
        {isCover && fig && (
          <div className="ppt-fig cover-fig">
            <img src={fig} alt="" draggable={false} />
          </div>
        )}
      </div>
      <div className="ppt-slide-foot">{slide.page_id}</div>
    </div>
  )
}

/**
 * 预览 + 本页讲稿：左缩略图 + 中舞台 + 下方对应当页口播。
 */
export function SlidesPreview({
  projectId,
  pack,
  onRun,
  onRefresh,
  onConfirmPreview,
  onFocusPage,
  busy,
  hasFinal,
  hasDraft,
  scriptRev = 0,
  downloadActions = null,
}) {
  const [idx, setIdx] = useState(0)
  const [preamble, setPreamble] = useState('')
  const [byPage, setByPage] = useState({})
  const [pageDraft, setPageDraft] = useState('')
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [scriptDirty, setScriptDirty] = useState(false)
  const [scriptErr, setScriptErr] = useState('')
  const [regenScriptBusy, setRegenScriptBusy] = useState(false)
  const [scriptUndoByPage, setScriptUndoByPage] = useState({})
  const [snapshots, setSnapshots] = useState([])
  const [snapPick, setSnapPick] = useState('')
  const [restoreMsg, setRestoreMsg] = useState('')
  const touchX = useRef(null)
  const railRef = useRef(null)
  const slides = pack?.slides || []
  const n = slides.length
  const selected = slides[Math.min(idx, Math.max(n - 1, 0))] || null
  const pageKey = selected ? normPageId(selected.page_id) : ''
  const pptx = pack?.pptx_download
  const hasExports = Boolean(pack?.has_exports)
  const hasFullPng = Boolean(selected?.export_thumb_url)
  const canRegenFig = Boolean(selected && !NO_FIG_ROLES.has(selected.page_role || ''))
  const canGenScript = Boolean(hasFinal || hasDraft || pptx)

  useEffect(() => {
    onFocusPage?.(selected?.page_id || null)
  }, [selected?.page_id, onFocusPage])

  const refreshSnapshots = useCallback(async () => {
    if (!projectId) return
    try {
      const r = await api.listVisualSnapshots(projectId)
      const snaps = r.snapshots || []
      setSnapshots(snaps)
      setSnapPick((prev) => (prev && snaps.some((s) => s.id === prev) ? prev : snaps[0]?.id || ''))
    } catch {
      setSnapshots([])
      setSnapPick('')
    }
  }, [projectId])

  useEffect(() => {
    refreshSnapshots()
  }, [refreshSnapshots, pack?.count, scriptRev])

  async function restoreSnapshot(snapshotId) {
    if (!projectId || !snapshotId) return
    if (!window.confirm(`恢复到版本 ${snapshotId}？当前状态会先再存一份。`)) return
    setRestoreMsg('')
    try {
      const r = await api.restoreVisualSnapshot(projectId, snapshotId)
      setRestoreMsg(`已回退到 ${r.restored_from}`)
      await onRefresh?.()
      await refreshSnapshots()
      if (pptx) onRun?.('rerender_export', { pptx: 'draft-with-images.pptx' })
    } catch (e) {
      setRestoreMsg(String(e.message || e))
    }
  }

  function snapLabel(s) {
    const reason = (s.reason || '').replace(/^before:/, '改前 · ').replace(/^pre-restore-of-/, '回退前 · ')
    return `${s.id}${reason ? ` · ${reason}` : ''}`
  }

  const loadScript = useCallback(async () => {
    if (!projectId) return
    setScriptErr('')
    try {
      const r = await api.getLectureScript(projectId)
      const parsed = parseLectureScript(r.text || '')
      setPreamble(parsed.preamble)
      setByPage(parsed.byPage)
      setScriptLoaded(true)
      setScriptDirty(false)
    } catch {
      setPreamble('')
      setByPage({})
      setScriptLoaded(false)
      setScriptDirty(false)
    }
  }, [projectId])

  useEffect(() => {
    loadScript()
  }, [loadScript, scriptRev])

  useEffect(() => {
    setIdx((i) => {
      if (!n) return 0
      return Math.min(i, n - 1)
    })
  }, [n, pack?.count])

  // 翻页或讲稿重载时同步编辑区（有未保存修改时不覆盖）
  useEffect(() => {
    if (!pageKey) {
      setPageDraft('')
      return
    }
    if (scriptDirty) return
    setPageDraft(byPage[pageKey]?.body || '')
  }, [pageKey, byPage, scriptDirty])

  const go = useCallback(
    (delta) => {
      if (!n) return
      setIdx((i) => {
        const cur = slides[i]
        const curKey = cur ? normPageId(cur.page_id) : ''
        if (curKey) {
          setByPage((prev) => ({
            ...prev,
            [curKey]: {
              title: prev[curKey]?.title || cur?.page_title || '',
              body: pageDraft,
            },
          }))
          setScriptDirty(false)
        }
        return (i + delta + n) % n
      })
    },
    [n, pageDraft, slides],
  )

  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        go(1)
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setIdx(0)
      }
      if (e.key === 'End') {
        e.preventDefault()
        setIdx(Math.max(0, n - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, n])

  useEffect(() => {
    const rail = railRef.current
    const el = document.getElementById(`film-${idx}`)
    if (!rail || !el) return
    const target = el.offsetTop - rail.clientHeight / 2 + el.clientHeight / 2
    rail.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [idx])

  const onTouchStart = (e) => {
    touchX.current = e.changedTouches[0].clientX
  }
  const onTouchEnd = (e) => {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) < 48) return
    go(dx < 0 ? 1 : -1)
  }

  function regenThisPage() {
    if (!selected?.page_id) return
    if (!canRegenFig) return
    api
      .clearFigurePrompt(projectId, { pageId: selected.page_id })
      .catch(() => null)
      .finally(() => onRun('fill', { only: [selected.page_id] }))
  }

  function generateScript() {
    const name = hasFinal ? 'final.pptx' : hasDraft || pptx ? 'draft-with-images.pptx' : null
    if (!name) {
      setScriptErr('尚无 PPT，请先配图生成草稿。')
      return
    }
    onRun('lecture_script', { pptx: name })
  }

  async function saveScript() {
    if (!projectId || !pageKey) return
    setScriptErr('')
    const nextMap = {
      ...byPage,
      [pageKey]: {
        title: byPage[pageKey]?.title || selected?.page_title || '',
        body: pageDraft,
      },
    }
    setByPage(nextMap)
    try {
      const md = buildLectureScript(preamble, slides, nextMap)
      await api.putLectureScript(projectId, md)
      setScriptLoaded(true)
      setScriptDirty(false)
    } catch (e) {
      setScriptErr(String(e.message || e))
    }
  }

  async function regenPageScript() {
    if (!projectId || !pageKey || !canGenScript) return
    if (scriptDirty && !window.confirm('本页讲稿有未保存修改，重新生成将覆盖，继续？')) return
    setScriptErr('')
    setRegenScriptBusy(true)
    const prevBody = pageDraft
    try {
      const pptxName = hasFinal ? 'final.pptx' : 'draft-with-images.pptx'
      const r = await api.regenerateLecturePage(projectId, pageKey, { pptx: pptxName })
      const body = String(r.script || '').trim()
      if (!body) throw new Error('模型未返回讲稿')
      setScriptUndoByPage((prev) => ({ ...prev, [pageKey]: prevBody }))
      setByPage((prev) => ({
        ...prev,
        [pageKey]: {
          title: prev[pageKey]?.title || selected?.page_title || '',
          body,
        },
      }))
      setPageDraft(body)
      setScriptLoaded(true)
      setScriptDirty(false)
    } catch (e) {
      setScriptErr(String(e.message || e))
    } finally {
      setRegenScriptBusy(false)
    }
  }

  async function undoPageScript() {
    if (!projectId || !pageKey) return
    if (!(pageKey in scriptUndoByPage)) return
    const prevBody = scriptUndoByPage[pageKey]
    setScriptErr('')
    const nextMap = {
      ...byPage,
      [pageKey]: {
        title: byPage[pageKey]?.title || selected?.page_title || '',
        body: prevBody,
      },
    }
    setByPage(nextMap)
    setPageDraft(prevBody)
    setScriptUndoByPage((prev) => {
      const next = { ...prev }
      delete next[pageKey]
      return next
    })
    try {
      const md = buildLectureScript(preamble, slides, nextMap)
      await api.putLectureScript(projectId, md)
      setScriptLoaded(true)
      setScriptDirty(false)
    } catch (e) {
      setScriptErr(String(e.message || e))
    }
  }

  function selectThumb(i) {
    if (pageKey) {
      setByPage((prev) => ({
        ...prev,
        [pageKey]: {
          title: prev[pageKey]?.title || selected?.page_title || '',
          body: pageDraft,
        },
      }))
      setScriptDirty(false)
    }
    setIdx(i)
  }

  return (
    <div className="preview-panel">
      <div className="toolbar">
        <div className="toolbar-meta">
          完成 · <strong>{pack?.count ?? 0}</strong> 页
          {downloadActions && <span className="toolbar-downloads">{downloadActions}</span>}
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || !pptx}
            title="按当前主题重渲 PPT，再用 LibreOffice（或本机 PowerPoint）导出预览图"
            onClick={() => onRun('rerender_export', { pptx: 'draft-with-images.pptx' })}
          >
            {hasExports ? '刷新预览' : '生成预览'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !canGenScript}
            onClick={generateScript}
            title="按页生成口播讲稿"
          >
            {scriptLoaded ? '重生成讲稿' : '生成讲稿'}
          </button>
          <details className="toolbar-more">
            <summary className="btn ghost">更多</summary>
            <div className="toolbar-menu">
              <button
                type="button"
                className="btn"
                disabled={busy || !snapshots.length}
                title={snapshots[0] ? `回退到 ${snapshots[0].id}` : '暂无版本'}
                onClick={() => restoreSnapshot(snapshots[0]?.id)}
              >
                回退上版
              </button>
              <div className="toolbar-menu-label">版本记录</div>
              {snapshots.length ? (
                <>
                  <select
                    value={snapPick}
                    disabled={busy}
                    onChange={(e) => setSnapPick(e.target.value)}
                    title="选择历史版本"
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {snapLabel(s)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !snapPick}
                    onClick={() => restoreSnapshot(snapPick)}
                  >
                    恢复所选
                  </button>
                </>
              ) : (
                <span className="muted">暂无快照</span>
              )}
            </div>
          </details>
          {onConfirmPreview && (
            <button type="button" className="btn primary" disabled={busy} onClick={onConfirmPreview}>
              下一步
            </button>
          )}
        </div>
      </div>
      <div className="preview-notice" role="note">
        <p>
          注意：论文裁图可能不够准确，下载 PPT 后请核对裁剪范围与图注，必要时手动修正。
        </p>
      </div>
      {restoreMsg && <p className="muted">{restoreMsg}</p>}

      {!n && (
        <p className="muted section">
          尚无幻灯片计划。请先在「配图」页跑「一键配图」或 AI 补图，再回来预览。
        </p>
      )}

      {n > 0 && selected && (
        <>
          <div className="preview-wb">
            <div className="preview-rail" ref={railRef} role="listbox" aria-label="幻灯片列表">
              <div className="preview-rail-h">幻灯片</div>
              {slides.map((s, i) => {
                const thumb = s.export_thumb_url || s.figure_thumb_url
                const hasNote = Boolean((byPage[normPageId(s.page_id)]?.body || '').trim())
                return (
                  <button
                    key={s.page_id}
                    id={`film-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === idx}
                    className={
                      'preview-thumb' + (i === idx ? ' sel' : '') + (hasNote ? ' has-note' : '')
                    }
                    onClick={() => selectThumb(i)}
                    title={s.page_title || s.page_id}
                  >
                    <span className="preview-thumb-n">{String(i + 1).padStart(2, '0')}</span>
                    {thumb ? (
                      <img src={thumb} alt="" loading="lazy" />
                    ) : (
                      <span className="ph">{String(i + 1).padStart(2, '0')}</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div
              className="preview-desk"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              <div className="preview-desk-head">
                <span className="preview-pg">
                  <strong>{String(idx + 1).padStart(2, '0')}</strong>
                  <span className="muted"> / {n}</span>
                  <span className="preview-pg-title">{selected.page_title}</span>
                </span>
              </div>

              <div className="preview-carousel">
                <button type="button" className="preview-nav prev" aria-label="上一页" onClick={() => go(-1)}>
                  ‹
                </button>
                <div className="ppt-mat">
                  <div className="ppt-frame">
                    {hasFullPng ? (
                      <img
                        className="ppt-export"
                        src={selected.export_thumb_url}
                        alt={selected.page_title || selected.page_id}
                        draggable={false}
                      />
                    ) : (
                      <PptSlide slide={selected} pageNo={idx + 1} total={n} />
                    )}
                  </div>
                </div>
                <button type="button" className="preview-nav next" aria-label="下一页" onClick={() => go(1)}>
                  ›
                </button>
              </div>

              <div className="preview-desk-foot">
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || !selected?.page_id || !canRegenFig}
                  title={canRegenFig ? '重跑当前页 AI 配图' : '此页不配图'}
                  onClick={regenThisPage}
                >
                  {busy ? '运行中…' : '重新生成'}
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || !snapshots.length}
                  title={snapshots[0] ? `回退到配图快照 ${snapshots[0].id}` : '暂无配图快照'}
                  onClick={() => restoreSnapshot(snapshots[0]?.id)}
                >
                  回退
                </button>
              </div>
            </div>
          </div>

          <div className="page-lecture">
            <div className="page-lecture-head">
              <span>
                本页讲稿 · <strong>{pageKey || selected.page_id}</strong>
                {scriptDirty ? ' · 未保存' : scriptLoaded ? ' · 已同步写入 PPT 备注' : ''}
              </span>
              <div className="row">
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || regenScriptBusy || !canGenScript}
                  title="仅重新生成本页口播讲稿"
                  onClick={regenPageScript}
                >
                  {regenScriptBusy ? '生成中…' : '重新生成'}
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || regenScriptBusy || !(pageKey in scriptUndoByPage)}
                  title="回退到重新生成前的本页讲稿"
                  onClick={undoPageScript}
                >
                  回退
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || regenScriptBusy || !scriptDirty}
                  onClick={saveScript}
                >
                  保存本页
                </button>
              </div>
            </div>
            {scriptErr && <p className="errbox">{scriptErr}</p>}
            <textarea
              className="page-lecture-editor"
              value={pageDraft}
              placeholder="本页口播…"
              disabled={regenScriptBusy}
              onChange={(e) => {
                setPageDraft(e.target.value)
                setScriptDirty(true)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
