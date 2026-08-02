import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

const INTENTS = [
  { value: 'overview', label: '总览' },
  { value: 'mechanism', label: '机制' },
  { value: 'comparison', label: '对照' },
  { value: 'scenario', label: '情景' },
  { value: 'terms', label: '术语' },
  { value: 'figure_reading', label: '读图' },
  { value: 'misconception', label: '误区' },
  { value: 'summary', label: '小结' },
  { value: 'custom', label: '自定义' },
]

function nextNumId(items, prefix, field) {
  let max = 0
  for (const it of items || []) {
    const m = String(it[field] || '').match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

function nextBeatId(beats, kpId) {
  let max = 0
  for (const b of beats || []) {
    const m = String(b.beat_id || '').match(/B(\d+)$/i)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${kpId}-B${String(max + 1).padStart(2, '0')}`
}

/** UI label from SEC01 / KP03 / KP01-B02 — keep raw ids only in data. */
function zhId(id, { shortBeat = false } = {}) {
  const s = String(id || '')
  const beat = s.match(/^KP(\d+)-B(\d+)$/i)
  if (beat) {
    return shortBeat
      ? `第 ${Number(beat[2])} 页`
      : `知识点 ${Number(beat[1])} · 第 ${Number(beat[2])} 页`
  }
  const sec = s.match(/^SEC(\d+)$/i)
  if (sec) return `章节 ${Number(sec[1])}`
  const kp = s.match(/^KP(\d+)$/i)
  if (kp) return `知识点 ${Number(kp[1])}`
  return s
}

function reorder(arr, index, dir) {
  const j = index + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[index], arr[j]] = [arr[j], arr[index]]
  arr.forEach((item, i) => {
    item.order = i + 1
  })
}

function TreeActions({ onAdd, addLabel, onDelete, canDelete, onUp, onDown, canUp, canDown }) {
  return (
    <div className="tree-acts" onClick={(e) => e.stopPropagation()}>
      {onAdd && (
        <button type="button" className="btn sm" onClick={onAdd} title={addLabel}>
          + {addLabel}
        </button>
      )}
      {onUp && (
        <button type="button" className="btn sm" disabled={!canUp} onClick={onUp} title="上移">
          ↑
        </button>
      )}
      {onDown && (
        <button type="button" className="btn sm" disabled={!canDown} onClick={onDown} title="下移">
          ↓
        </button>
      )}
      {onDelete && (
        <button type="button" className="btn sm danger" disabled={!canDelete} onClick={onDelete} title="删除">
          删除
        </button>
      )}
    </div>
  )
}

/** Editable outline tree: course meta + section / KP / beat fields. */
export function OutlineEditor({ outline, onChange, onSave, onConfirm, onGenerate, projectId, busy }) {
  const [dirty, setDirty] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [snapshots, setSnapshots] = useState([])
  const [restoreMsg, setRestoreMsg] = useState('')

  const refreshSnapshots = useCallback(async () => {
    if (!projectId) {
      setSnapshots([])
      return
    }
    try {
      const r = await api.listOutlineSnapshots(projectId)
      setSnapshots(r.snapshots || [])
    } catch {
      setSnapshots([])
    }
  }, [projectId])

  useEffect(() => {
    refreshSnapshots()
  }, [refreshSnapshots, outline?.status, (outline?.sections || []).length])

  async function restoreLast() {
    if (!projectId || !snapshots.length) return
    const target = snapshots[0]?.id
    if (!target) return
    if (!window.confirm(`回退到大纲上一版 ${target}？当前版本会先再存一份。`)) return
    setRestoreMsg('')
    try {
      const r = await api.restoreOutlineSnapshot(projectId, target)
      setRestoreMsg(`已回退到 ${r.restored_from}`)
      const next = await api.getOutline(projectId)
      onChange?.(next)
      setDirty(false)
      await refreshSnapshots()
    } catch (e) {
      setRestoreMsg(String(e.message || e))
    }
  }

  if (!outline) return <p className="muted">暂无大纲</p>

  function patch(mutator) {
    const next = structuredClone(outline)
    mutator(next)
    setDirty(true)
    onChange(next)
  }

  function isCollapsed(id) {
    return Boolean(collapsed[id])
  }

  function toggleCollapse(id) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function Twist({ id, count }) {
    const closed = isCollapsed(id)
    return (
      <button
        type="button"
        className={'tree-twist' + (closed ? '' : ' open')}
        aria-expanded={!closed}
        title={closed ? '展开' : '收起'}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          toggleCollapse(id)
        }}
      >
        <span aria-hidden>▸</span>
        {typeof count === 'number' && closed ? (
          <span className="tree-twist-count">{count}</span>
        ) : null}
      </button>
    )
  }

  const sections = outline.sections || []
  const pageCount = sections.reduce(
    (n, sec) =>
      n +
      (sec.knowledge_points || []).reduce(
        (m, kp) => m + ((kp.teaching_beats || []).length || 0),
        0,
      ),
    0,
  )
  const kpCount = sections.reduce((n, sec) => n + ((sec.knowledge_points || []).length || 0), 0)
  const statusLabel =
    outline.status === 'user_confirmed' ? '已确认' : outline.status === 'draft' ? '草稿' : outline.status

  async function handleConfirm() {
    if (dirty) {
      await onSave(outline)
      setDirty(false)
    }
    await onConfirm()
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-meta">
          大纲 · <strong>{statusLabel}</strong>
          {dirty ? ' · 未保存' : ''}
          {' · '}
          <strong>{pageCount}</strong> 页
          <span className="muted">
            {' '}
            · {sections.length} 章 · {kpCount} 知识点
          </span>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={!sections.length}
            onClick={() => {
              const next = {}
              for (const sec of sections) {
                next[sec.section_id] = true
                for (const kp of sec.knowledge_points || []) {
                  next[kp.kp_id] = true
                }
              }
              setCollapsed(next)
            }}
            title="收起全部章节与知识点"
          >
            全部收起
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setCollapsed({})}
            title="展开全部"
          >
            全部展开
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !dirty}
            onClick={async () => {
              await onSave(outline)
              setDirty(false)
              await refreshSnapshots()
            }}
          >
            保存
          </button>
          {onGenerate && (
            <button
              type="button"
              className="btn"
              disabled={busy || dirty}
              title={dirty ? '请先保存' : '根据需求 AI 重拟大纲'}
              onClick={onGenerate}
            >
              重拟
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={busy || !snapshots.length}
            title={snapshots[0] ? `回退到 ${snapshots[0].id}` : '暂无上一版大纲'}
            onClick={restoreLast}
          >
            回退上版
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={handleConfirm}
            title="确认后进入下一步"
          >
            下一步
          </button>
        </div>
      </div>
      {restoreMsg && <p className="muted">{restoreMsg}</p>}

      <div className="grid" style={{ marginBottom: '0.75rem', marginTop: '0.75rem' }}>
        <label>
          首页短标题（可后改）
          <input
            value={outline.course_title || ''}
            onChange={(e) =>
              patch((o) => {
                o.course_title = e.target.value
              })
            }
          />
        </label>
        <label>
          受众
          <input
            value={outline.audience || ''}
            onChange={(e) =>
              patch((o) => {
                o.audience = e.target.value
              })
            }
          />
        </label>
        <div className="row">
          <label style={{ flex: 1 }}>
            课时（分钟）
            <input
              type="number"
              value={outline.target_minutes ?? 50}
              onChange={(e) =>
                patch((o) => {
                  o.target_minutes = Number(e.target.value) || 50
                })
              }
            />
          </label>
          <label style={{ flex: 1 }}>
            学科
            <input
              value={outline.subject || ''}
              onChange={(e) =>
                patch((o) => {
                  o.subject = e.target.value
                })
              }
            />
          </label>
        </div>
      </div>

      <div className="tree">
        {sections.map((sec, si) => {
          const kps = sec.knowledge_points || []
          const secClosed = isCollapsed(sec.section_id)
          return (
            <div key={sec.section_id} className={'sec-block' + (secClosed ? ' collapsed' : '')}>
              <div className="tree-head">
                <Twist id={sec.section_id} count={kps.length} />
                <label className="sec" style={{ flex: 1, margin: 0 }}>
                  {zhId(sec.section_id)}
                  <input
                    value={sec.title || ''}
                    onChange={(e) =>
                      patch((o) => {
                        o.sections[si].title = e.target.value
                      })
                    }
                  />
                </label>
                <TreeActions
                  addLabel="知识点"
                  onAdd={() => {
                    patch((o) => {
                      const allKps = (o.sections || []).flatMap((s) => s.knowledge_points || [])
                      const kpId = nextNumId(allKps, 'KP', 'kp_id')
                      const list = o.sections[si].knowledge_points || []
                      list.push({
                        kp_id: kpId,
                        title: '新知识点',
                        learning_objective: '学习目标待填',
                        order: list.length + 1,
                        must_cover: false,
                        teaching_beats: [
                          {
                            beat_id: `${kpId}-B01`,
                            title: '新页',
                            intent: 'custom',
                            order: 1,
                            needs_figure: false,
                            on_slide_points: ['要点 — 待填写'],
                          },
                        ],
                      })
                      o.sections[si].knowledge_points = list
                    })
                    setCollapsed((prev) => ({ ...prev, [sec.section_id]: false }))
                  }}
                  canDelete={sections.length > 1}
                  onDelete={() => {
                    if (!window.confirm(`删除${zhId(sec.section_id)}？`)) return
                    patch((o) => {
                      o.sections.splice(si, 1)
                      o.sections.forEach((s, i) => {
                        s.order = i + 1
                      })
                    })
                  }}
                  canUp={si > 0}
                  canDown={si < sections.length - 1}
                  onUp={() =>
                    patch((o) => {
                      reorder(o.sections, si, -1)
                    })
                  }
                  onDown={() =>
                    patch((o) => {
                      reorder(o.sections, si, 1)
                    })
                  }
                />
              </div>

              {!secClosed &&
                kps.map((kp, ki) => {
                  const beats = kp.teaching_beats || []
                  const kpClosed = isCollapsed(kp.kp_id)
                  return (
                    <div key={kp.kp_id} className={'kp-block' + (kpClosed ? ' collapsed' : '')}>
                      <div className="tree-head">
                        <Twist id={kp.kp_id} count={beats.length} />
                        <label className="kp" style={{ flex: 1, margin: 0 }}>
                          {zhId(kp.kp_id)}
                          <input
                            value={kp.title || ''}
                            onChange={(e) =>
                              patch((o) => {
                                o.sections[si].knowledge_points[ki].title = e.target.value
                              })
                            }
                          />
                        </label>
                        <TreeActions
                          addLabel="页"
                          onAdd={() => {
                            patch((o) => {
                              const list = o.sections[si].knowledge_points[ki].teaching_beats || []
                              const kpId = o.sections[si].knowledge_points[ki].kp_id
                              list.push({
                                beat_id: nextBeatId(list, kpId),
                                title: '新页',
                                intent: 'custom',
                                order: list.length + 1,
                                needs_figure: false,
                                on_slide_points: ['要点 — 待填写'],
                              })
                              o.sections[si].knowledge_points[ki].teaching_beats = list
                            })
                            setCollapsed((prev) => ({ ...prev, [kp.kp_id]: false }))
                          }}
                          canDelete={kps.length > 1}
                          onDelete={() => {
                            if (!window.confirm(`删除${zhId(kp.kp_id)}？`)) return
                            patch((o) => {
                              o.sections[si].knowledge_points.splice(ki, 1)
                              o.sections[si].knowledge_points.forEach((k, i) => {
                                k.order = i + 1
                              })
                            })
                          }}
                          canUp={ki > 0}
                          canDown={ki < kps.length - 1}
                          onUp={() =>
                            patch((o) => {
                              reorder(o.sections[si].knowledge_points, ki, -1)
                            })
                          }
                          onDown={() =>
                            patch((o) => {
                              reorder(o.sections[si].knowledge_points, ki, 1)
                            })
                          }
                        />
                      </div>
                      {!kpClosed && (
                        <>
                          <label className="kp">
                            学习目标
                            <input
                              value={kp.learning_objective || ''}
                              onChange={(e) =>
                                patch((o) => {
                                  o.sections[si].knowledge_points[ki].learning_objective = e.target.value
                                })
                              }
                            />
                          </label>
                          {beats.map((b, bi) => (
                            <div key={b.beat_id} className="beat-block">
                              <div className="tree-head">
                                <div className="muted" style={{ fontSize: '0.78rem' }}>
                                  {zhId(b.beat_id, { shortBeat: true })}
                                </div>
                                <TreeActions
                                  canDelete={beats.length > 1}
                                  onDelete={() => {
                                    if (!window.confirm(`删除${zhId(b.beat_id)}？`)) return
                                    patch((o) => {
                                      o.sections[si].knowledge_points[ki].teaching_beats.splice(bi, 1)
                                      o.sections[si].knowledge_points[ki].teaching_beats.forEach(
                                        (x, i) => {
                                          x.order = i + 1
                                        },
                                      )
                                    })
                                  }}
                                  canUp={bi > 0}
                                  canDown={bi < beats.length - 1}
                                  onUp={() =>
                                    patch((o) => {
                                      reorder(o.sections[si].knowledge_points[ki].teaching_beats, bi, -1)
                                    })
                                  }
                                  onDown={() =>
                                    patch((o) => {
                                      reorder(o.sections[si].knowledge_points[ki].teaching_beats, bi, 1)
                                    })
                                  }
                                />
                              </div>
                              <div className="row">
                                <label style={{ flex: 2 }}>
                                  标题
                                  <input
                                    value={b.title || ''}
                                    onChange={(e) =>
                                      patch((o) => {
                                        o.sections[si].knowledge_points[ki].teaching_beats[bi].title =
                                          e.target.value
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  页意图
                                  <select
                                    value={b.intent || 'custom'}
                                    onChange={(e) =>
                                      patch((o) => {
                                        o.sections[si].knowledge_points[ki].teaching_beats[bi].intent =
                                          e.target.value
                                      })
                                    }
                                  >
                                    {INTENTS.map((x) => (
                                      <option key={x.value} value={x.value}>
                                        {x.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="check">
                                  <input
                                    type="checkbox"
                                    checked={!!b.needs_figure}
                                    onChange={(e) =>
                                      patch((o) => {
                                        o.sections[si].knowledge_points[ki].teaching_beats[
                                          bi
                                        ].needs_figure = e.target.checked
                                      })
                                    }
                                  />
                                  配图
                                </label>
                              </div>
                              <label>
                                配图提示
                                <input
                                  value={b.figure_hint || ''}
                                  onChange={(e) =>
                                    patch((o) => {
                                      o.sections[si].knowledge_points[ki].teaching_beats[bi].figure_hint =
                                        e.target.value || null
                                    })
                                  }
                                />
                              </label>
                              <label>
                                页上要点（一行一条）
                                <textarea
                                  value={(b.on_slide_points || []).join('\n')}
                                  onChange={(e) =>
                                    patch((o) => {
                                      o.sections[si].knowledge_points[ki].teaching_beats[
                                        bi
                                      ].on_slide_points = e.target.value
                                        .split('\n')
                                        .map((x) => x.trim())
                                        .filter(Boolean)
                                    })
                                  }
                                />
                              </label>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>

      <div className="row section">
        <button
          type="button"
          className="btn"
          onClick={() =>
            patch((o) => {
              const sid = nextNumId(o.sections || [], 'SEC', 'section_id')
              const allKps = (o.sections || []).flatMap((s) => s.knowledge_points || [])
              const kpId = nextNumId(allKps, 'KP', 'kp_id')
              o.sections = o.sections || []
              o.sections.push({
                section_id: sid,
                title: '新章节',
                order: o.sections.length + 1,
                knowledge_points: [
                  {
                    kp_id: kpId,
                    title: '新知识点',
                    learning_objective: '学习目标待填',
                    order: 1,
                    must_cover: false,
                    teaching_beats: [
                      {
                        beat_id: `${kpId}-B01`,
                        title: '新页',
                        intent: 'custom',
                        order: 1,
                        needs_figure: false,
                        on_slide_points: ['要点 — 待填写'],
                      },
                    ],
                  },
                ],
              })
            })
          }
        >
          + 添加章节
        </button>
      </div>
    </div>
  )
}
