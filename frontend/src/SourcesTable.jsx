import React, { useMemo, useRef, useState } from 'react'
import { api } from './api.js'

function labelScreen(v) {
  return { keep: '保留', maybe: '待定', drop: '丢弃' }[v] || v || '—'
}
function labelConfirm(v) {
  return { selected: '已选用', rejected: '不用', proposed: '待确认' }[v] || v || '—'
}

const FILTERS_MAIN = [
  { value: 'all', label: '全部' },
  { value: 'proposed', label: '待确认' },
  { value: 'selected', label: '已选用' },
]
const FILTERS_MORE = [
  { value: 'user', label: '我添加的' },
  { value: 'keep', label: 'AI 保留' },
  { value: 'maybe', label: 'AI 待定' },
  { value: 'drop', label: 'AI 丢弃' },
]

export function SourcesTable({
  projectId,
  sources,
  counts,
  onDecide,
  onRun,
  onNext,
  onSourcesChange,
  busy,
}) {
  const [filter, setFilter] = useState('all')
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [authors, setAuthors] = useState('')
  const [doi, setDoi] = useState('')
  const [localErr, setLocalErr] = useState('')
  const [localMsg, setLocalMsg] = useState('')
  const fileRef = useRef(null)

  const rows = useMemo(() => {
    const list = sources || []
    if (filter === 'all') return list
    if (filter === 'proposed') return list.filter((s) => s.user_confirmation === 'proposed')
    if (filter === 'selected') return list.filter((s) => s.user_confirmation === 'selected')
    if (filter === 'keep') return list.filter((s) => s.screening_decision === 'keep')
    if (filter === 'maybe') return list.filter((s) => s.screening_decision === 'maybe')
    if (filter === 'drop') return list.filter((s) => s.screening_decision === 'drop')
    if (filter === 'user') return list.filter((s) => s.from_user)
    return list
  }, [sources, filter])

  async function submitManual(e) {
    e?.preventDefault?.()
    if (!projectId || !title.trim() || busy) return
    setLocalErr('')
    setLocalMsg('')
    try {
      const r = await api.addManualSource(projectId, {
        title: title.trim(),
        year: year ? Number(year) : null,
        authors: authors.trim() || null,
        doi: doi.trim() || null,
      })
      setTitle('')
      setYear('')
      setAuthors('')
      setDoi('')
      setLocalMsg(`已添加 ${r.source?.source_id || ''}`.trim())
      await onSourcesChange?.()
    } catch (err) {
      setLocalErr(String(err.message || err))
    }
  }

  async function onUploadFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !projectId || busy) return
    setLocalErr('')
    setLocalMsg('')
    try {
      const r = await api.uploadSourcePdfs(projectId, files)
      const n = (r.saved || []).length
      const errs = r.errors || []
      setLocalMsg(n ? `已上传 ${n} 篇 PDF` : '')
      if (errs.length) setLocalErr(errs.map((x) => `${x.name}: ${x.error}`).join('；'))
      await onSourcesChange?.()
    } catch (err) {
      setLocalErr(String(err.message || err))
    }
  }

  const addBar = (
    <form className="sources-add" onSubmit={submitManual}>
      <div className="sources-add-head">指定文献 / 上传 PDF</div>
      <div className="sources-add-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文献标题（必填）"
          disabled={busy}
          required
        />
        <input
          className="sources-add-year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="年份"
          inputMode="numeric"
          disabled={busy}
        />
        <button type="submit" className="btn ghost sm" disabled={busy || !title.trim()}>
          添加
        </button>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={onUploadFiles} />
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          上传 PDF
        </button>
      </div>
      <div className="sources-add-row secondary">
        <input
          value={authors}
          onChange={(e) => setAuthors(e.target.value)}
          placeholder="作者（可选，逗号分隔）"
          disabled={busy}
        />
        <input
          value={doi}
          onChange={(e) => setDoi(e.target.value)}
          placeholder="DOI（可选）"
          disabled={busy}
        />
      </div>
      {localMsg && <p className="muted">{localMsg}</p>}
      {localErr && <p className="errbox">{localErr}</p>}
    </form>
  )

  if (!sources) {
    return (
      <div>
        <div className="toolbar">
          <div className="toolbar-meta">尚无文献</div>
          <div className="toolbar-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => onRun('retrieve_screen')}
              title="检索文献后立刻 AI 初筛"
            >
              检索并初筛
            </button>
          </div>
        </div>
        {addBar}
      </div>
    )
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-meta">
          文献 · <strong>{counts?.selected ?? 0}</strong> / {counts?.total ?? 0}
          {(counts?.proposed ?? 0) > 0 ? ` · ${counts.proposed} 待确认` : ''}
        </div>
        <div className="toolbar-actions">
          <div className="sources-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onRun('retrieve_screen')}
              title="重新检索并 AI 初筛（会保留你手动添加的文献）"
            >
              检索并初筛
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onRun('confirm_sources')}
              title="把 AI 保留/待定的文献全部标为已选用"
            >
              全部选用
            </button>
          </div>
          <div className="sources-filters" role="tablist" aria-label="筛选文献">
            {FILTERS_MAIN.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                className={'btn ghost sm' + (filter === f.value ? ' on' : '')}
                disabled={busy}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
            <details className="toolbar-more sources-filter-more">
              <summary
                className={
                  'btn ghost sm' + (FILTERS_MORE.some((f) => f.value === filter) ? ' on' : '')
                }
              >
                {FILTERS_MORE.find((f) => f.value === filter)?.label || '更多'}
              </summary>
              <div className="toolbar-menu">
                {FILTERS_MORE.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={'btn ghost sm' + (filter === f.value ? ' on' : '')}
                    disabled={busy}
                    onClick={(e) => {
                      setFilter(f.value)
                      e.currentTarget.closest('details')?.removeAttribute('open')
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </details>
          </div>
          <button type="button" className="btn primary" disabled={busy || !onNext} onClick={onNext}>
            下一步
          </button>
        </div>
      </div>

      {addBar}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>编号</th>
              <th>标题</th>
              <th>AI 建议</th>
              <th>你的决定</th>
              <th>知识点</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.source_id}>
                <td>
                  <code>{s.source_id}</code>
                  <div className="muted">{s.year || ''}</div>
                  {s.from_user && <div className="muted">用户</div>}
                </td>
                <td>
                  <div>{s.title}</div>
                  <div className="muted">
                    {s.doi || s.pmid || ''}
                    {s.fulltext_status ? ` · ft:${s.fulltext_status}` : ''}
                  </div>
                  {s.screening_reason && <div className="muted">{s.screening_reason.slice(0, 120)}</div>}
                </td>
                <td>
                  <span
                    className={
                      'pill' +
                      (s.screening_decision === 'keep'
                        ? ' ok'
                        : s.screening_decision === 'drop'
                          ? ' err'
                          : ' warn')
                    }
                  >
                    {labelScreen(s.screening_decision)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      'pill' +
                      (s.user_confirmation === 'selected'
                        ? ' ok'
                        : s.user_confirmation === 'rejected'
                          ? ' err'
                          : ' warn')
                    }
                  >
                    {labelConfirm(s.user_confirmation)}
                  </span>
                </td>
                <td className="muted">{(s.mapped_knowledge_points || []).join(', ')}</td>
                <td>
                  <div className="row">
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy || s.user_confirmation === 'selected'}
                      onClick={() => onDecide(s.source_id, 'selected')}
                    >
                      选用
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy || s.user_confirmation === 'rejected'}
                      onClick={() => onDecide(s.source_id, 'rejected')}
                    >
                      不用
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
