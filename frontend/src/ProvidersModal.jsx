import React, { useEffect, useState } from 'react'
import * as PV from './providers.js'

const LIT_FIELDS = [
  { key: 'NCBI_EMAIL', label: 'NCBI Email', plain: true, placeholder: 'you@example.com' },
  { key: 'NCBI_API_KEY', label: 'NCBI API Key', plain: false, placeholder: '可选 · 提高 PubMed 限额' },
  { key: 'SPRINGER_API_KEY', label: 'Springer Meta Key', plain: false, placeholder: 'dev.springernature.com' },
  {
    key: 'SPRINGER_OA_API_KEY',
    label: 'Springer OA Key',
    plain: false,
    placeholder: '可与 Meta 相同或留空回退',
  },
  { key: 'WOS_API_KEY', label: 'Web of Science Key', plain: false, placeholder: '可选 · Clarivate' },
  {
    key: 'SEMANTIC_SCHOLAR_API_KEY',
    label: 'Semantic Scholar Key',
    plain: false,
    placeholder: '可选 · 提高限额',
  },
  { key: 'OPENALEX_EMAIL', label: 'OpenAlex Email', plain: true, placeholder: '礼貌池邮箱（可选）' },
  { key: 'UNPAYWALL_EMAIL', label: 'Unpaywall Email', plain: true, placeholder: '全文解析邮箱（可选）' },
  { key: 'SCOPUS_API_KEY', label: 'Scopus Key', plain: false, placeholder: '可选' },
  { key: 'ELSEVIER_API_KEY', label: 'Elsevier Key', plain: false, placeholder: '可选 · 全文' },
  { key: 'GOOGLE_BOOKS_API_KEY', label: 'Google Books Key', plain: false, placeholder: '可选 · 教材' },
]

function emptyLit() {
  const o = {}
  for (const f of LIT_FIELDS) o[f.key] = ''
  return o
}

function Cap({ on, label }) {
  return (
    <span className={'pv-cap' + (on ? ' on' : '')}>
      <i />
      {label}
      <b>{on ? '可用' : '未配置'}</b>
    </span>
  )
}

export function ProvidersModal({ onClose }) {
  const [state, setState] = useState(null)
  const [draft, setDraft] = useState(() => PV.loadDraft())
  const [busy, setBusy] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [textModels, setTextModels] = useState([])
  const [manualModel, setManualModel] = useState(true)
  const [litMore, setLitMore] = useState(false)

  useEffect(() => {
    let alive = true
    PV.fetchState()
      .then((s) => {
        if (!alive) return
        setState(s)
        setDraft((d) => {
          const lit = { ...emptyLit(), ...(d.literature || {}) }
          const fields = s.literature?.fields || {}
          for (const f of LIT_FIELDS) {
            if (lit[f.key]) continue
            if (f.plain && fields[f.key]?.value) lit[f.key] = fields[f.key].value
          }
          const next = {
            text: {
              base_url: d.text?.base_url || s.text?.base_url || '',
              api_key: d.text?.api_key || '',
              model: d.text?.model || s.text?.model || '',
            },
            image: {
              provider: d.image?.provider || s.image?.provider || 'openai_compat',
              base_url: d.image?.base_url || s.image?.base_url || '',
              api_key: d.image?.api_key || '',
              model: d.image?.model || s.image?.model || '',
            },
            literature: lit,
          }
          PV.saveDraft(next)
          return next
        })
      })
      .catch(() => alive && setState(false))
    return () => {
      alive = false
    }
  }, [])

  const text = draft.text || {}
  const image = draft.image || { provider: 'openai_compat' }
  const literature = draft.literature || emptyLit()

  function setText(k, v) {
    const d = { ...draft, text: { ...text, [k]: v } }
    setDraft(d)
    PV.saveDraft(d)
  }
  function setImage(k, v) {
    const d = { ...draft, image: { ...image, [k]: v } }
    setDraft(d)
    PV.saveDraft(d)
  }
  function setLit(k, v) {
    const d = { ...draft, literature: { ...literature, [k]: v } }
    setDraft(d)
    PV.saveDraft(d)
  }

  const textReady = Boolean(text.api_key || state?.capabilities?.text)
  const imageReady =
    image.provider === 'bailian' ||
    Boolean(image.api_key) ||
    Boolean(state?.capabilities?.image)
  const litReady =
    Boolean(state?.capabilities?.literature) ||
    LIT_FIELDS.some((f) => Boolean(String(literature[f.key] || '').trim()))

  async function test(kind) {
    setBusy(kind)
    setMsg(null)
    if (kind === 'text') {
      const r = await PV.testConn({
        kind: 'text',
        api_key: text.api_key,
        base_url: text.base_url,
        model: text.model,
      })
      setBusy('')
      setTextModels(r.models || [])
      setManualModel(!(r.models && r.models.length))
      setMsg({ ok: r.ok, text: '文本模型 · ' + (r.detail || '') })
    } else if (kind === 'literature') {
      const r = await PV.testConn({
        kind: 'literature',
        provider: 'springer',
        api_key: literature.SPRINGER_API_KEY || '',
      })
      setBusy('')
      setMsg({ ok: r.ok, text: '文献 · ' + (r.detail || '') })
    } else {
      const r = await PV.testConn({
        kind: 'image',
        provider: image.provider,
        api_key: image.api_key,
        base_url: image.base_url,
        model: image.model,
      })
      setBusy('')
      setMsg({ ok: r.ok, text: '图片 · ' + (r.detail || '') })
    }
  }

  async function saveLocal() {
    setSaving(true)
    setMsg(null)
    try {
      const s = await PV.saveToServer({ text, image, literature })
      setState(s)
      setMsg({ ok: true, text: '已保存到本机（providers.json + ~/.aut_sci_write/.env）' })
    } catch (e) {
      setMsg({ ok: false, text: String(e.message || e) })
    }
    setSaving(false)
  }

  const primaryLit = LIT_FIELDS.slice(0, 8)
  const extraLit = LIT_FIELDS.slice(8)
  const shownLit = litMore ? LIT_FIELDS : primaryLit

  return (
    <div className="pv-back" onClick={onClose} role="presentation">
      <div className="pv-sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="pv-head">
          <div className="pv-title">
            模型能力 <span className="pv-mode">本机模式</span>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="pv-caps">
          <Cap on={textReady} label="文本模型" />
          <Cap on={imageReady} label="AI 图片" />
          <Cap on={litReady} label="文献 API" />
        </div>

        <section className="pv-sec">
          <div className="pv-sec-h">
            文本模型 <span>（大纲 / 副驾 / 讲稿 · OpenAI 兼容 /v1）</span>
          </div>
          <label className="pv-f">
            <span>Base URL</span>
            <input
              value={text.base_url || ''}
              placeholder="https://…/v1"
              onChange={(e) => setText('base_url', e.target.value)}
            />
          </label>
          <label className="pv-f">
            <span>API Key</span>
            <input
              type="password"
              value={text.api_key || ''}
              placeholder={state?.text?.masked ? `已保存 ${state.text.masked} · 留空保留` : 'sk-…'}
              onChange={(e) => setText('api_key', e.target.value)}
            />
          </label>
          <label className="pv-f">
            <span>Model</span>
            {textModels.length && !manualModel ? (
              <select
                value={text.model || ''}
                onChange={(e) => {
                  if (e.target.value === '__manual__') {
                    setManualModel(true)
                    return
                  }
                  setText('model', e.target.value)
                }}
              >
                <option value="" disabled>
                  选择模型…
                </option>
                {textModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__manual__">✎ 手动填写…</option>
              </select>
            ) : (
              <input
                value={text.model || ''}
                placeholder="如 qwen-plus / gpt-4o / GLM-4 …"
                onChange={(e) => setText('model', e.target.value)}
              />
            )}
          </label>
          <div className="pv-row">
            <button type="button" className="btn" disabled={busy === 'text'} onClick={() => test('text')}>
              {busy === 'text' ? '测试中…' : '测试连接 · 拉模型'}
            </button>
            {textModels.length > 0 && (
              <button type="button" className="btn ghost" onClick={() => setManualModel((m) => !m)}>
                {manualModel ? '改为下拉选择' : '改为手动填写'}
              </button>
            )}
          </div>
        </section>

        <section className="pv-sec">
          <div className="pv-sec-h">
            图片模型 <span>（配图 AI 生图）</span>
          </div>
          <div className="pv-providers">
            <button
              type="button"
              className={'pv-prov' + (image.provider === 'openai_compat' ? ' on' : '')}
              onClick={() => setImage('provider', 'openai_compat')}
            >
              <b>OpenAI 兼容</b>
              <span>/images/generations · 任意网关</span>
            </button>
            <button
              type="button"
              className={'pv-prov' + (image.provider === 'bailian' ? ' on' : '')}
              onClick={() => setImage('provider', 'bailian')}
            >
              <b>百炼 CLI</b>
              <span>本机 bl · 可选保留</span>
            </button>
            <button
              type="button"
              className={'pv-prov' + (image.provider === 'none' ? ' on' : '')}
              onClick={() => setImage('provider', 'none')}
            >
              <b>关闭</b>
              <span>只用论文裁图</span>
            </button>
          </div>
          {image.provider === 'openai_compat' && (
            <>
              <label className="pv-f">
                <span>Base URL</span>
                <input
                  value={image.base_url || ''}
                  placeholder="https://…/v1（可与文本相同或不同）"
                  onChange={(e) => setImage('base_url', e.target.value)}
                />
              </label>
              <label className="pv-f">
                <span>API Key</span>
                <input
                  type="password"
                  value={image.api_key || ''}
                  placeholder={
                    state?.image?.masked ? `已保存 ${state.image.masked} · 留空保留` : 'sk-…'
                  }
                  onChange={(e) => setImage('api_key', e.target.value)}
                />
              </label>
              <label className="pv-f">
                <span>Model</span>
                <input
                  value={image.model || ''}
                  placeholder="如 gpt-image-1 / qwen-image-plus …"
                  onChange={(e) => setImage('model', e.target.value)}
                />
              </label>
              <div className="pv-row">
                <button
                  type="button"
                  className="btn"
                  disabled={busy === 'image'}
                  onClick={() => test('image')}
                >
                  {busy === 'image' ? '测试中…' : '测试连接'}
                </button>
              </div>
            </>
          )}
          {image.provider === 'bailian' && (
            <label className="pv-f">
              <span>Model</span>
              <input
                value={image.model || ''}
                placeholder="qwen-image-plus"
                onChange={(e) => setImage('model', e.target.value)}
              />
            </label>
          )}
        </section>

        <section className="pv-sec">
          <div className="pv-sec-h">
            文献 API <span>（检索 / 教材 · 与 Aut_Sci_Write 共用）</span>
          </div>
          {shownLit.map((f) => {
            const saved = state?.literature?.fields?.[f.key]
            const ph = f.plain
              ? f.placeholder
              : saved?.masked
                ? `已保存 ${saved.masked} · 留空保留`
                : f.placeholder
            return (
              <label className="pv-f" key={f.key}>
                <span>{f.label}</span>
                <input
                  type={f.plain ? 'text' : 'password'}
                  value={literature[f.key] || ''}
                  placeholder={ph}
                  autoComplete="off"
                  onChange={(e) => setLit(f.key, e.target.value)}
                />
              </label>
            )
          })}
          {extraLit.length > 0 && (
            <div className="pv-row">
              <button type="button" className="btn ghost" onClick={() => setLitMore((v) => !v)}>
                {litMore ? '收起可选项' : `更多（Scopus / Elsevier / Google Books）`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy === 'literature'}
                onClick={() => test('literature')}
              >
                {busy === 'literature' ? '测试中…' : '测试文献连通'}
              </button>
            </div>
          )}
        </section>

        {msg && <div className={'pv-msg' + (msg.ok ? ' ok' : ' err')}>{msg.text}</div>}

        <div className="pv-foot">
          <button type="button" className="btn primary" disabled={saving} onClick={saveLocal}>
            {saving ? '保存中…' : '保存到本机'}
          </button>
          <span className="pv-foot-note">改动已自动存浏览器</span>
        </div>
      </div>
    </div>
  )
}
