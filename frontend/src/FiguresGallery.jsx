import React, { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'

function figureTitle(f) {
  // 只展示绑定页名；库存图单独标注
  return f.used_on_label || '库存图'
}

function needsCaptionTranslate(f) {
  if (!f) return false
  if ((f.caption_zh || '').trim()) return false
  const en = (f.caption_en || '').trim()
  if (!en) return false
  if (/[\u4e00-\u9fff]/.test(en)) return false
  return true
}

function visualPhase(busy, job) {
  if (!busy) return null
  const step = job?.step || ''
  if (step === 'crop') return 'crop'
  if (step === 'fill' || step === 'fill_skip_resolved') return 'ai'
  if (step === 'run_default_pipeline') {
    const log = job?.log_tail || ''
    if (/fill_visuals|——\s*fill\s*——/i.test(log)) return 'ai'
    if (/crop_source|——\s*crop\s*——/i.test(log)) return 'crop'
    return 'prep'
  }
  return null
}

function ProgressBar({
  label,
  done,
  total,
  active,
  phaseLabel,
  unit = '页',
  selected = false,
  onSelect,
}) {
  const hasTotal = total > 0
  const pct = hasTotal ? Math.min(100, Math.round((done / total) * 100)) : active ? 0 : 0
  const indeterminate = active && !hasTotal
  const complete = hasTotal && done >= total && total > 0
  return (
    <div
      className={
        'fig-progress-row' +
        (active ? ' active' : '') +
        (complete ? ' complete' : '') +
        (selected ? ' filter-on' : '')
      }
    >
      <div className="fig-progress-label">
        <button
          type="button"
          className={'fig-progress-filter' + (selected ? ' on' : '')}
          onClick={onSelect}
          title={selected ? '点击取消筛选' : `只看${label}`}
        >
          {label}
        </button>
        <span className="fig-progress-meta">
          {indeterminate
            ? phaseLabel || '进行中…'
            : hasTotal
              ? `${done} / ${total} ${unit}${active && !complete ? ' · 进行中' : complete ? ' · 完成' : ''}`
              : active
                ? phaseLabel || '等待中…'
                : '暂无任务'}
        </span>
      </div>
      <div className="fig-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={'fig-progress-fill' + (indeterminate ? ' indeterminate' : '')}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function FiguresGallery({
  projectId,
  figures,
  counts,
  onRun,
  onFiguresChange,
  onGoPreview,
  onGoSources,
  proposedCount = 0,
  busy,
  job,
}) {
  const [kind, setKind] = useState('all')
  const [preview, setPreview] = useState(null)
  const [translating, setTranslating] = useState(false)
  const [translateErr, setTranslateErr] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [restoreMsg, setRestoreMsg] = useState('')
  const [desc, setDesc] = useState('')
  const [snapPick, setSnapPick] = useState('')
  const [descHist, setDescHist] = useState([])
  const [descOpen, setDescOpen] = useState(false)

  const phase = visualPhase(busy, job)
  const cropTotal = counts?.crop_total ?? counts?.source_crop ?? 0
  const cropDone = counts?.crop_done ?? 0
  const aiTotal = counts?.ai_total ?? counts?.ai ?? 0
  const aiDone = counts?.ai_done ?? 0
  const refreshRef = React.useRef(onFiguresChange)
  refreshRef.current = onFiguresChange

  const rows = useMemo(() => {
    const list = figures || []
    if (kind === 'all') return list
    if (kind === 'with_file') return list.filter((f) => f.has_file)
    if (kind === 'source_crop') return list.filter((f) => f.figure_kind === 'source_crop')
    if (kind === 'ai') return list.filter((f) => f.figure_kind === 'ai_scientific_illustration')
    return list
  }, [figures, kind])

  async function refreshSnapshots() {
    if (!projectId) return
    try {
      const r = await api.listVisualSnapshots(projectId)
      const snaps = r.snapshots || []
      setSnapshots(snaps)
      setSnapPick((prev) => prev || snaps[0]?.id || '')
    } catch {
      setSnapshots([])
      setSnapPick('')
    }
  }

  useEffect(() => {
    refreshSnapshots()
  }, [projectId, figures])

  // 配图任务运行中轮询图库，驱动进度条
  useEffect(() => {
    if (!busy || !phase || !projectId) return undefined
    let stop = false
    const tick = async () => {
      if (stop) return
      try {
        await refreshRef.current?.()
      } catch {
        /* ignore */
      }
      if (!stop) setTimeout(tick, 2000)
    }
    const first = setTimeout(tick, 600)
    return () => {
      stop = true
      clearTimeout(first)
    }
  }, [busy, phase, projectId])

  async function openPreview(f) {
    // 无缩略图也可点开（空位 / 失败页），才能看到「重新生成」
    setTranslateErr('')
    setPreview(f)
    if (!projectId || !needsCaptionTranslate(f)) return
    setTranslating(true)
    try {
      const r = await api.translateFigureCaption(projectId, f.figure_id)
      setPreview((prev) =>
        prev && prev.figure_id === f.figure_id
          ? { ...prev, caption_zh: r.caption_zh, caption: r.caption_zh }
          : prev,
      )
      if (onFiguresChange) await onFiguresChange()
    } catch (e) {
      setTranslateErr(String(e.message || e))
    } finally {
      setTranslating(false)
    }
  }

  async function restoreLast() {
    if (!projectId || !snapshots.length) return
    const target = snapPick || snapshots[0]?.id
    const label = target || '上一版'
    if (!window.confirm(`恢复到快照 ${label}？当前状态会先再存一份快照。`)) return
    setRestoreMsg('')
    try {
      const r = await api.restoreVisualSnapshot(projectId, target)
      setRestoreMsg(`已恢复 ${r.restored_from}（${r.count} 项）`)
      setPreview(null)
      if (onFiguresChange) await onFiguresChange()
      await refreshSnapshots()
    } catch (e) {
      setRestoreMsg(String(e.message || e))
    }
  }

  function regenPreviewPage() {
    if (!preview) return
    const pages = preview.used_on_pages || []
    const pageId = pages[0]?.page_id
    if (!pageId) {
      setRestoreMsg('这张图未挂到具体页，无法按页重跑。请到「预览」选页后重跑。')
      return
    }
    if (preview.figure_kind !== 'ai_scientific_illustration') {
      setRestoreMsg('仅 AI 示意图可重跑；论文裁图请换图或到预览页处理。')
      return
    }
    setPreview(null)
    setRestoreMsg(`正在重跑 ${pages[0].page_title || pageId}（${pageId}）的 AI 配图…`)
    onRun('fill', { only: [pageId] })
  }

  async function regenPreviewWithPrompt() {
    if (!preview || !desc.trim()) return
    const pages = preview.used_on_pages || []
    const pageId = pages[0]?.page_id
    if (!pageId) {
      setRestoreMsg('这张图未挂到具体页。')
      return
    }
    if (preview.figure_kind !== 'ai_scientific_illustration') {
      setRestoreMsg('仅 AI 示意图支持口述重生成。')
      return
    }
    setRestoreMsg('正在按描述准备生图…')
    try {
      const r = await api.copilotFigure(projectId, pageId, desc.trim())
      setDescHist(r.prompt_history || descHist)
      setPreview(null)
      setDesc('')
      setDescOpen(false)
      setRestoreMsg(`已按描述重跑 ${pageId}…`)
      onRun('fill', { only: [pageId] })
    } catch (e) {
      setRestoreMsg(String(e.message || e))
    }
  }

  async function openDescHistory() {
    const pageId = (preview?.used_on_pages || [])[0]?.page_id
    if (!projectId || !pageId) {
      setDescOpen(true)
      return
    }
    setDescOpen(true)
    try {
      const r = await api.figurePromptHistory(projectId, pageId)
      setDescHist(r.history || [])
    } catch {
      /* keep local */
    }
  }

  const canRestore = snapshots.length > 0
  const previewPages = preview?.used_on_pages || []
  const canRegenPreview =
    Boolean(previewPages[0]?.page_id) &&
    preview?.figure_kind === 'ai_scientific_illustration'

  function ensureSourcesReady() {
    if (!(proposedCount > 0)) return true
    const tip =
      `还有 ${proposedCount} 篇文献仍为「待确认」，配图前需要先选用。` +
      `\n请到「文献」页点「全部选用」或逐条「选用」。`
    if (window.confirm(`${tip}\n\n现在去文献页？`)) {
      onGoSources?.()
    }
    return false
  }

  function runVisual(step) {
    if (!ensureSourcesReady()) return
    onRun(step)
  }

  function toggleKind(next) {
    setKind((prev) => (prev === next ? 'all' : next))
  }

  async function deleteFigure(f, e) {
    e?.stopPropagation?.()
    if (!projectId || !f?.figure_id || busy) return
    const title = figureTitle(f)
    const pages = f.used_on_pages || []
    const tip =
      pages.length > 0
        ? `删除「${title}」？已绑定 ${pages.length} 页会解除绑定。`
        : `删除「${title}」？`
    if (!window.confirm(tip)) return
    try {
      await api.deleteFigure(projectId, f.figure_id)
      if (preview?.figure_id === f.figure_id) setPreview(null)
      if (onFiguresChange) await onFiguresChange()
    } catch (err) {
      window.alert(String(err.message || err))
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-meta">
          配图 · <strong>{counts?.with_file ?? 0}</strong> 张
          {proposedCount > 0 ? (
            <span className="fig-gate-warn"> · 文献尚有 {proposedCount} 篇待确认</span>
          ) : null}
        </div>
        <div className="toolbar-actions">
          <div className="btn-split">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => runVisual('run_default_pipeline')}
              title="抽证据 / 规划 / 裁图 / 补图；开始前自动快照"
            >
              一键配图
            </button>
            <details className="btn-split-more">
              <summary className="btn" title="更多配图方式">
                ▾
              </summary>
              <div className="toolbar-menu">
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={(e) => {
                    runVisual('crop')
                    e.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                >
                  仅论文裁图
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={(e) => {
                    runVisual('fill_skip_resolved')
                    e.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                  title="只生成还没有图的页，已有配图保留"
                >
                  补缺图（跳过已有）
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={(e) => {
                    runVisual('fill')
                    e.currentTarget.closest('details')?.removeAttribute('open')
                  }}
                >
                  仅 AI 生图（全部重跑）
                </button>
              </div>
            </details>
          </div>
          <details className="toolbar-more">
            <summary className="btn ghost">更多</summary>
            <div className="toolbar-menu">
              <button
                type="button"
                className="btn"
                disabled={busy || !canRestore}
                onClick={restoreLast}
              >
                回退配图
              </button>
              {canRestore && (
                <select
                  value={snapPick}
                  onChange={(e) => setSnapPick(e.target.value)}
                  disabled={busy}
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.reason || 'snapshot'}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </details>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => onGoPreview && onGoPreview()}
          >
            下一步
          </button>
        </div>
      </div>
      <div className="fig-progress">
        <ProgressBar
          label="论文裁图"
          done={cropDone}
          total={cropTotal}
          active={phase === 'crop' || (phase === 'prep' && cropTotal === 0)}
          phaseLabel={phase === 'prep' ? '规划中…' : '裁图中…'}
          selected={kind === 'source_crop'}
          onSelect={() => toggleKind('source_crop')}
        />
        <ProgressBar
          label="AI 生图"
          done={aiDone}
          total={aiTotal}
          active={phase === 'ai' || (phase === 'prep' && cropTotal > 0 && aiTotal === 0)}
          phaseLabel="生图中…"
          selected={kind === 'ai'}
          onSelect={() => toggleKind('ai')}
        />
      </div>
      {restoreMsg && <p className="muted">{restoreMsg}</p>}

      {!figures && <p className="muted">尚无配图目录</p>}

      <div className="gallery">
        {rows.map((f) => (
          <div className="card-fig" key={f.figure_id}>
            <button type="button" className="card-fig-main" onClick={() => openPreview(f)}>
              {f.thumb_url ? (
                <img src={f.thumb_url} alt={figureTitle(f)} loading="lazy" />
              ) : (
                <div className="ph">{f.figure_kind_zh || '暂无文件'}</div>
              )}
              <div className="meta">
                <strong>{figureTitle(f)}</strong>
                <span className="muted">
                  {f.figure_kind_zh || f.figure_kind}
                  {f.source_id ? ` · 来源 ${f.source_id}` : ''}
                </span>
                {f.caption && <span className="cap">{f.caption}</span>}
              </div>
            </button>
            <button
              type="button"
              className="card-fig-del"
              disabled={busy}
              title="删除"
              onClick={(e) => deleteFigure(f, e)}
            >
              删除
            </button>
          </div>
        ))}
      </div>

      {preview && (
        <div className="lightbox" onClick={() => setPreview(null)} role="presentation">
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="lightbox-toolbar">
              <strong>{figureTitle(preview)}</strong>
              <div className="row">
                {canRegenPreview && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    title="重跑本页 AI 配图"
                    onClick={regenPreviewPage}
                  >
                    {busy ? '运行中…' : '重新生成'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || !canRestore}
                  title={canRestore ? '回退到最近一次配图快照' : '暂无配图快照'}
                  onClick={restoreLast}
                >
                  回退
                </button>
                <button
                  type="button"
                  className="btn ghost sm danger"
                  disabled={busy}
                  onClick={(e) => deleteFigure(preview, e)}
                >
                  删除
                </button>
                <button type="button" className="btn ghost sm" onClick={() => setPreview(null)}>
                  关闭
                </button>
              </div>
            </div>
            {preview.thumb_url ? (
              <img src={preview.thumb_url} alt={figureTitle(preview)} />
            ) : (
              <div className="ph lightbox-ph">暂无图片文件 · 可点上方「重新生成」</div>
            )}
            {canRegenPreview && (
              <div className="copilot-composer" style={{ marginTop: '0.65rem' }}>
                <div className="copilot-input-wrap">
                  <input
                    value={desc}
                    disabled={busy}
                    placeholder="改这张图…"
                    onChange={(e) => setDesc(e.target.value)}
                    onFocus={openDescHistory}
                    onClick={openDescHistory}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        regenPreviewWithPrompt()
                      }
                      if (e.key === 'Escape') setDescOpen(false)
                    }}
                  />
                  {descOpen && descHist.length > 0 && (
                    <ul className="copilot-history" role="listbox">
                      {descHist.map((h) => (
                        <li key={h}>
                          <button
                            type="button"
                            disabled={busy}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setDesc(h)
                              setDescOpen(false)
                            }}
                          >
                            {h}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || !desc.trim()}
                  onClick={regenPreviewWithPrompt}
                >
                  改图
                </button>
              </div>
            )}
            {translateErr && <p className="errbox">{translateErr}</p>}
            {preview.caption && !translating && <p className="muted">{preview.caption}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
