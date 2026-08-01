import React, { useEffect, useRef, useState } from 'react'

/**
 * Compact AI copilot.
 * - variant "inline": single-row composer
 * - variant "chat": dialogue thread + composer (rail 副驾)
 * - default: chips + composer + last status line
 */
export function CopilotPanel({
  title = 'AI 副驾',
  hint,
  chips = [],
  history = [],
  historyKey,
  chatKey,
  placeholder = '跟副驾说点什么…',
  busy,
  onSend,
  onHistoryOpen,
  variant = 'default',
  multiline = false,
  className = '',
  composerHeight,
  onSplitDragStart,
  splitDragging = false,
}) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [openHist, setOpenHist] = useState(false)
  const [localHist, setLocalHist] = useState([])
  const [turns, setTurns] = useState([])
  const [sending, setSending] = useState(false)
  const wrapRef = useRef(null)
  const threadRef = useRef(null)
  const inline = variant === 'inline'
  const chat = variant === 'chat'
  const storageKey = chatKey || (chat && historyKey ? `${historyKey}:thread` : null)

  useEffect(() => {
    if (!historyKey || chat) return
    try {
      const raw = localStorage.getItem(historyKey)
      const arr = raw ? JSON.parse(raw) : []
      if (Array.isArray(arr)) setLocalHist(arr.filter((x) => typeof x === 'string' && x.trim()))
    } catch {
      setLocalHist([])
    }
  }, [historyKey, chat])

  useEffect(() => {
    if (!storageKey) {
      setTurns([])
      return
    }
    try {
      const raw = localStorage.getItem(storageKey)
      const arr = raw ? JSON.parse(raw) : []
      if (Array.isArray(arr)) {
        setTurns(
          arr
            .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && String(t.text || '').trim())
            .slice(-40),
        )
      } else setTurns([])
    } catch {
      setTurns([])
    }
    setErr('')
    setMsg('')
  }, [storageKey])

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(turns.slice(-40)))
    } catch {
      /* ignore quota */
    }
  }, [turns, storageKey])

  useEffect(() => {
    if (!chat || !threadRef.current) return
    threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [turns, sending, chat])

  useEffect(() => {
    function onDoc(e) {
      if (!wrapRef.current?.contains(e.target)) setOpenHist(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const mergedHistory = (() => {
    if (chat) return []
    const seen = new Set()
    const out = []
    for (const item of [...(history || []), ...localHist]) {
      const t = String(item || '').trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out.slice(0, 20)
  })()

  function remember(v) {
    if (!historyKey || !v || chat) return
    const next = [v, ...localHist.filter((x) => x !== v)].slice(0, 20)
    setLocalHist(next)
    try {
      localStorage.setItem(historyKey, JSON.stringify(next))
    } catch {
      /* ignore quota */
    }
  }

  async function submit(value) {
    const v = (value ?? text).trim()
    if (!v || busy || sending) return
    setErr('')
    setOpenHist(false)
    if (chat) {
      setTurns((prev) => [...prev, { role: 'user', text: v, at: Date.now() }])
      setText('')
      setSending(true)
      try {
        const r = await onSend(v)
        const reply = String(r?.summary || r?.message || '已完成').trim()
        setTurns((prev) => [...prev, { role: 'assistant', text: reply || '已完成', at: Date.now() }])
      } catch (e) {
        const fail = String(e.message || e)
        setTurns((prev) => [...prev, { role: 'assistant', text: `出错了：${fail}`, at: Date.now(), error: true }])
        setErr(fail)
      } finally {
        setSending(false)
      }
      return
    }

    setMsg(inline ? '' : '副驾处理中…')
    try {
      const r = await onSend(v)
      remember(v)
      if (!inline) setMsg(r?.summary || r?.message || '已完成')
      setText('')
    } catch (e) {
      setErr(String(e.message || e))
      setMsg('')
    }
  }

  const locked = busy || sending

  return (
    <div
      className={
        'copilot' +
        (inline ? ' inline' : '') +
        (chat ? ' chat' : '') +
        (className ? ` ${className}` : '')
      }
    >
      {!inline && (
        <div className="copilot-head">
          <span className={'copilot-dot' + (locked ? ' busy' : '')} />
          <strong>{title}</strong>
          {hint && <span className="muted">{hint}</span>}
          {chat && turns.length > 0 && (
            <button
              type="button"
              className="btn ghost sm copilot-clear"
              disabled={locked}
              onClick={() => {
                setTurns([])
                setErr('')
              }}
              title="清空对话"
            >
              清空
            </button>
          )}
        </div>
      )}
      {!inline && chips.length > 0 && (
        <div className="copilot-chips">
          {chips.map((c) => (
            <button key={c} type="button" className="chip" disabled={locked} onClick={() => submit(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {chat && (
        <>
          <div className="copilot-thread" ref={threadRef} aria-live="polite">
            {turns.length === 0 && !sending && (
              <p className="copilot-empty muted">跟副驾说说要改什么，会按对话记下往来。</p>
            )}
            {turns.map((t, i) => (
              <div
                key={`${t.at || i}-${t.role}-${i}`}
                className={'copilot-bubble ' + t.role + (t.error ? ' error' : '')}
              >
                <div className="copilot-bubble-role">{t.role === 'user' ? '你' : '副驾'}</div>
                <div className="copilot-bubble-text">{t.text}</div>
              </div>
            ))}
            {sending && (
              <div className="copilot-bubble assistant pending">
                <div className="copilot-bubble-role">副驾</div>
                <div className="copilot-bubble-text">处理中…</div>
              </div>
            )}
          </div>
          {onSplitDragStart && (
            <div
              className={'rail-v-resizer' + (splitDragging ? ' is-dragging' : '')}
              role="separator"
              aria-orientation="horizontal"
              title="拖拽调整输入框高度（对话区自动让位）"
              onMouseDown={onSplitDragStart}
            />
          )}
        </>
      )}

      <div className={'copilot-composer' + (chat ? ' pinned' : '')} ref={wrapRef}>
        <div className="copilot-input-wrap">
          {multiline || chat ? (
            <textarea
              value={text}
              disabled={locked}
              placeholder={placeholder}
              rows={chat ? 4 : 6}
              style={
                chat && composerHeight
                  ? {
                      minHeight: composerHeight,
                      height: composerHeight,
                      maxHeight: 'none',
                      resize: 'none',
                    }
                  : undefined
              }
              onChange={(e) => setText(e.target.value)}
              onFocus={async () => {
                if (chat) return
                setOpenHist(true)
                if (onHistoryOpen) {
                  try {
                    await onHistoryOpen()
                  } catch {
                    /* ignore */
                  }
                }
              }}
              onClick={() => {
                if (!chat) setOpenHist(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (chat && !e.shiftKey))) {
                  if (chat && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                    return
                  }
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault()
                    submit()
                  }
                }
                if (e.key === 'Escape') setOpenHist(false)
              }}
            />
          ) : (
            <input
              value={text}
              disabled={locked}
              placeholder={placeholder}
              onChange={(e) => setText(e.target.value)}
              onFocus={async () => {
                setOpenHist(true)
                if (onHistoryOpen) {
                  try {
                    await onHistoryOpen()
                  } catch {
                    /* ignore */
                  }
                }
              }}
              onClick={() => setOpenHist(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
                if (e.key === 'Escape') setOpenHist(false)
              }}
            />
          )}
          {!chat && openHist && mergedHistory.length > 0 && (
            <ul className="copilot-history" role="listbox">
              {mergedHistory.map((h) => (
                <li key={h}>
                  <button
                    type="button"
                    disabled={locked}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setText(h)
                      setOpenHist(false)
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
          className={'btn' + (inline ? ' sm' : ' primary')}
          disabled={locked || !text.trim()}
          onClick={() => submit()}
        >
          {inline ? '改图' : sending ? '发送中…' : '发送'}
        </button>
      </div>
      {!inline && !chat && msg && <p className="copilot-msg">{msg}</p>}
      {!chat && err && <p className="errbox">{err}</p>}
    </div>
  )
}
