import React, { useEffect, useState } from 'react'
import { CopilotPanel } from './CopilotPanel.jsx'
import { api } from './api.js'

const SCREEN_META = {
  outline: {
    hint: '改大纲',
    placeholder: '例如：加一章 ADMET…',
    chips: ['加一章 ADMET', '删掉过细的知识点'],
  },
  sources: {
    hint: '文献',
    placeholder: '例如：多找几篇 / 至少 10 篇 / 少点只要 2 篇…',
    chips: ['多找几篇', '至少 10 篇', '少点只要 2 篇'],
  },
  figures: {
    hint: '配图',
    placeholder: '例如：全部改成更简洁的示意图…',
    chips: ['全部改成更简洁的示意图', '风格统一成白板手绘'],
  },
  preview: {
    hint: '完成',
    placeholder: '例如：批量改图… / 本页讲稿短一点…',
    chips: ['全部配图更清晰', '本页讲稿短一点'],
  },
  complete: {
    hint: '完成',
    placeholder: '例如：批量改图… / 本页讲稿短一点…',
    chips: ['全部配图更清晰', '本页讲稿短一点'],
  },
  theme: {
    hint: '版式',
    placeholder: '选好主题后点下一步…',
    chips: [],
  },
}

const PANEL_KEY = 'sci-studio-copilot-h'
const COMPOSER_KEY = 'sci-studio-copilot-composer-h'

function loadNum(key, def, min, max) {
  try {
    const n = Number(localStorage.getItem(key))
    if (Number.isFinite(n) && n >= min && n <= max) return Math.round(n)
  } catch {
    /* ignore */
  }
  return def
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Docked at rail bottom — one AI copilot for the whole studio, routed by screen.
 * Bottom composer is fixed; top drag only expands the chat area.
 */
export function StudioCopilot({
  screen,
  projectId,
  pageId,
  busy,
  onOutline,
  onRunStep,
  onRefresh,
  onLecture,
}) {
  const [panelH, setPanelH] = useState(() => loadNum(PANEL_KEY, 380, 240, 720))
  const [composerH, setComposerH] = useState(() => loadNum(COMPOSER_KEY, 108, 64, 280))
  const [drag, setDrag] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, String(panelH))
      localStorage.setItem(COMPOSER_KEY, String(composerH))
    } catch {
      /* ignore */
    }
  }, [panelH, composerH])

  useEffect(() => {
    if (!drag) return undefined
    function onMove(e) {
      if (drag.kind === 'panel') {
        const max = Math.min(720, Math.floor(window.innerHeight * 0.72))
        // 向上拖 → 整体变高，只拉长对话区；底部输入栏高度不变
        setPanelH(clamp(drag.startPanel + (drag.startY - e.clientY), 240, max))
        return
      }
      if (drag.kind === 'composer') {
        // 中间线：只改输入框高度，对话区吃掉剩余空间
        const dy = e.clientY - drag.startY
        setComposerH(clamp(drag.startComposer - dy, 64, 280))
      }
    }
    function onUp() {
      setDrag(null)
      document.body.classList.remove('rail-v-resizing')
    }
    document.body.classList.add('rail-v-resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('rail-v-resizing')
    }
  }, [drag])

  if (!projectId) return null
  if (screen === 'input') return null

  const meta = SCREEN_META[screen] || {
    hint: '副驾',
    placeholder: '跟副驾说点什么…',
    chips: [],
  }

  return (
    <div
      className="rail-copilot"
      style={{ height: panelH, maxHeight: 'none', flex: '0 0 auto' }}
    >
      <div
        className={'rail-v-resizer' + (drag?.kind === 'panel' ? ' is-dragging' : '')}
        role="separator"
        aria-orientation="horizontal"
        title="拖拽调整副驾高度（只拉对话区，输入栏不动）"
        onMouseDown={(e) => {
          e.preventDefault()
          setDrag({ kind: 'panel', startY: e.clientY, startPanel: panelH })
        }}
      />
      <CopilotPanel
        variant="chat"
        title="AI 副驾"
        hint={meta.hint}
        chips={meta.chips}
        busy={busy}
        placeholder={meta.placeholder}
        chatKey={projectId ? `sci-studio-chat:${projectId}:${screen}` : undefined}
        composerHeight={composerH}
        splitDragging={drag?.kind === 'composer'}
        onSplitDragStart={(e) => {
          e.preventDefault()
          setDrag({
            kind: 'composer',
            startY: e.clientY,
            startComposer: composerH,
          })
        }}
        onSend={async (message) => {
          const r = await api.copilotStudio(projectId, {
            screen,
            message,
            page_id: pageId || undefined,
          })
          if (r.outline) onOutline?.(r.outline)
          if (r.lecture_script) onLecture?.(r.lecture_script)
          for (const a of r.actions || []) {
            if (a.type === 'run_step' && a.step) {
              onRunStep?.(a.step, a.extra || {})
            }
          }
          if (r.outline || r.lecture_script) onRefresh?.()
          return r
        }}
      />
    </div>
  )
}
