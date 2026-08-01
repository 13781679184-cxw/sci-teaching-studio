import React, { useMemo, useRef } from 'react'

const KIND_META = [
  { key: 'title', label: '首页' },
  { key: 'agenda', label: '议程页' },
  { key: 'content', label: '内容页' },
  { key: 'section', label: '章节名称页', optionalKey: 'section_dividers' },
  { key: 'thanks', label: '感谢页', optionalKey: 'thanks' },
]

const FALLBACK_DESIGNS = {
  title: [
    { id: 'plain', kind: 'title', name: '居中白底', blurb: '白底居中标题', wash: false, bottom_band: false },
    { id: 'wash', kind: 'title', name: '浅色叠底', blurb: '淡强调色铺底', wash: true },
    { id: 'band', kind: 'title', name: '底色条', blurb: '下方色带承托', bottom_band: true },
    { id: 'panel', kind: 'title', name: '色块分栏', blurb: '左侧宽色板白字', side_panel: true },
    { id: 'corners', kind: 'title', name: '角标开场', blurb: '对角 L 形色标', corner_marks: true },
  ],
  agenda: [
    { id: 'list', kind: 'agenda', name: '列表下划线', blurb: '标题下划线 + 列表', title_rule: 'full' },
    { id: 'topbar', kind: 'agenda', name: '纯色顶栏', blurb: '顶栏白字 + 列表', top_bar_solid: true },
    { id: 'numbered', kind: 'agenda', name: '彩色编号', blurb: '条目左侧强调色序号', title_rule: 'short', section_number: 'prefix' },
    { id: 'cards', kind: 'agenda', name: '条目色卡', blurb: '每条左侧色条', title_rule: 'short', section_number: 'prefix' },
  ],
  content: [
    { id: 'chapter', kind: 'content', name: '章节号', blurb: '彩色 1.2 + 短线（默认）', title_rule: 'short', section_number: 'prefix' },
    { id: 'rule', kind: 'content', name: '标题下划线', blurb: '1.2 编号 + 通栏线', title_rule: 'full', section_number: 'prefix' },
    { id: 'topbar', kind: 'content', name: '纯色顶栏', blurb: '顶栏白字，带 1.2', top_bar_solid: true, section_number: 'prefix' },
    { id: 'frame', kind: 'content', name: '色边框', blurb: '有色边框 + 1.2', title_rule: 'short', frame: true, section_number: 'prefix' },
    { id: 'strip', kind: 'content', name: '浅条眉头', blurb: '淡色眉条 + 1.2', soft_strip: true, title_rule: 'short', section_number: 'prefix' },
    { id: 'folio', kind: 'content', name: '大号页码', blurb: '1.2 + 淡色大页码', title_rule: 'short', page_number: 'soft', section_number: 'prefix' },
  ],
  section: [
    { id: 'big_num', kind: 'section', name: '大号章节', blurb: '超大编号 1. + 章名', section_number: 'hero' },
    { id: 'bar', kind: 'section', name: '色条章节', blurb: '顶栏「1. 章名」白字', top_bar_solid: true },
    { id: 'split', kind: 'section', name: '左右分列', blurb: '左编号右章名', section_number: 'badge', title_rule: 'short' },
    { id: 'fill', kind: 'section', name: '满版色块', blurb: '整页强调色白字', fill_accent: true },
    { id: 'ghost', kind: 'section', name: '水印编号', blurb: '淡色巨型编号衬底', watermark: true },
  ],
  thanks: [
    { id: 'centered', kind: 'thanks', name: '居中致谢', blurb: '白底居中' },
    { id: 'wash', kind: 'thanks', name: '浅底致谢', blurb: '淡色叠底', wash: true },
    { id: 'band', kind: 'thanks', name: '色条致谢', blurb: '底色条收束', bottom_band: true },
    { id: 'rules', kind: 'thanks', name: '双线致谢', blurb: '上下短色线', deco_rules: true },
    { id: 'halo', kind: 'thanks', name: '光晕致谢', blurb: '淡色椭圆托字', halo: true },
  ],
}

function DesignPreview({ kind, design, accent = '#2F5D50' }) {
  const d = design || {}
  const title = d.sample_title || d.name || '示例'
  const style = { '--lay-accent': accent, '--lay-ink': '#1A1A1A' }
  const boardClass =
    'layout-board kind-' +
    (kind === 'agenda' ? 'content' : kind) +
    (d.wash ? ' wash' : '') +
    (d.fill_accent ? ' fill-accent' : '')

  if (kind === 'title') {
    return (
      <div className={boardClass} style={style}>
        {d.bottom_band ? <span className="lay-bottom-band" /> : null}
        {d.side_panel ? <span className="lay-side-panel" /> : null}
        {d.corner_marks ? (
          <>
            <span className="lay-corner tl" />
            <span className="lay-corner br" />
          </>
        ) : null}
        {d.side_panel ? (
          <div className="lay-cover panel">
            <strong className="on-panel">{title}</strong>
            <span className="lay-sub side">研究生一年级 · 药物化学</span>
          </div>
        ) : (
          <div className="lay-cover">
            <strong>{title}</strong>
            <i className="lay-rule short center" />
            <span className="lay-sub">研究生一年级 · 药物化学</span>
          </div>
        )}
      </div>
    )
  }

  if (kind === 'agenda') {
    const numbered = d.id === 'numbered' || d.section_number === 'prefix'
    const cards = d.id === 'cards'
    return (
      <div className={boardClass} style={style}>
        {d.top_bar_solid ? <span className="lay-solid-bar" /> : null}
        <div className={'lay-body agenda' + (d.top_bar_solid ? ' with-solid' : '')}>
          <div className={'lay-title' + (d.top_bar_solid ? ' on-accent' : '')}>
            <span>本节议程</span>
          </div>
          {d.title_rule && d.title_rule !== 'none' && !d.top_bar_solid ? (
            <span className={'lay-rule' + (d.title_rule === 'short' ? ' short' : '')} />
          ) : null}
          {cards ? (
            <div className="lay-cards">
              <span />
              <span />
              <span className="short" />
            </div>
          ) : (
            <div className="lay-lines">
              <i className={numbered ? 'num' : ''} />
              <i className={numbered ? 'num' : ''} />
              <i className={'short' + (numbered ? ' num' : '')} />
            </div>
          )}
        </div>
        <span className="lay-page">02/24</span>
      </div>
    )
  }

  if (kind === 'section') {
    return (
      <div className={boardClass} style={style}>
        {d.top_bar_solid ? <span className="lay-solid-bar tall" /> : null}
        {d.watermark ? <em className="lay-watermark">2</em> : null}
        <div
          className={
            'lay-section-body' +
            (d.top_bar_solid ? ' on-bar' : '') +
            (d.fill_accent ? ' on-fill' : '') +
            (d.watermark ? ' over-ghost' : '') +
            (d.id === 'split' ? ' split' : '')
          }
        >
          {!d.top_bar_solid && !d.watermark ? <em className="lay-hero-num">2</em> : null}
          <span>{d.top_bar_solid ? `2.  ${title}` : title}</span>
          {d.id === 'split' || d.title_rule === 'short' ? <i className="lay-rule short" /> : null}
        </div>
      </div>
    )
  }

  if (kind === 'thanks') {
    return (
      <div className={boardClass} style={style}>
        {d.bottom_band ? <span className="lay-bottom-band" /> : null}
        {d.halo ? <span className="lay-halo" /> : null}
        <div className="lay-cover">
          {d.deco_rules ? <i className="lay-rule short center deco" /> : null}
          <strong>谢谢</strong>
          {d.deco_rules ? <i className="lay-rule short center deco" /> : null}
          <span className="lay-sub">欢迎提问</span>
        </div>
      </div>
    )
  }

  // content
  return (
    <div className={boardClass} style={style}>
      {d.frame ? <span className="lay-frame" /> : null}
      {d.top_bar_solid ? <span className="lay-solid-bar" /> : null}
      {d.soft_strip ? <span className="lay-soft-strip" /> : null}
      <div
        className={
          'lay-body' +
          (d.top_bar_solid ? ' with-solid' : '') +
          (d.soft_strip ? ' with-strip' : '') +
          (d.frame ? ' with-frame' : '')
        }
      >
        <div className={'lay-title' + (d.top_bar_solid ? ' on-accent' : '')}>
          {d.section_number === 'prefix' ? <em>1.2</em> : null}
          <span>{title}</span>
        </div>
        {d.title_rule && d.title_rule !== 'none' && !d.top_bar_solid ? (
          <span className={'lay-rule' + (d.title_rule === 'short' ? ' short' : '')} />
        ) : null}
        <div className="lay-lines">
          <i />
          <i />
          <i className="short" />
        </div>
        <div className="lay-fig" />
      </div>
      {d.page_number === 'soft' ? <span className="lay-page soft">05</span> : <span className="lay-page">05/24</span>}
    </div>
  )
}

/**
 * Per-page-kind design picker + accent + optional section/thanks toggles.
 */
export function ThemePicker({
  themes,
  designsByKind,
  value,
  designs = {},
  accent,
  customAccents = [],
  optionalPages = { section_dividers: false, thanks: false },
  onChangeTheme,
  onChangeDesign,
  onChangeAccent,
  onAddCustomAccent,
  onChangeOptional,
  compact = false,
}) {
  const colorRef = useRef(null)
  const themeList = themes || []
  const byKind = designsByKind && Object.keys(designsByKind).length ? designsByKind : FALLBACK_DESIGNS
  const currentAccent = accent || themeList.find((t) => t.id === value)?.accent || '#2F5D50'

  const colorDots = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const t of themeList) {
      const a = (t.accent || '').toUpperCase()
      if (!a || seen.has(a)) continue
      seen.add(a)
      out.push({ id: t.id, name: t.name, accent: t.accent, builtin: true })
    }
    for (const c of customAccents || []) {
      const a = String(c || '').toUpperCase()
      if (!a || seen.has(a)) continue
      seen.add(a)
      out.push({ id: `custom:${a}`, name: '自定义', accent: a, builtin: false })
    }
    return out
  }, [themeList, customAccents])

  return (
    <div className={'theme-studio' + (compact ? ' compact' : '')}>
      <section className="theme-block">
        <div className="theme-block-h">强调色</div>
        <div className="accent-row" role="listbox" aria-label="强调色">
          {colorDots.map((c) => {
            const on = String(currentAccent).toUpperCase() === String(c.accent).toUpperCase()
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={on}
                className={'accent-dot' + (on ? ' on' : '')}
                style={{ '--dot': c.accent }}
                title={c.name}
                onClick={() => {
                  if (c.builtin) onChangeTheme?.(c.id)
                  else onChangeAccent?.(c.accent)
                }}
              />
            )
          })}
          <button
            type="button"
            className="accent-add"
            title="从色环选择自定义颜色"
            onClick={() => colorRef.current?.click()}
          >
            +
          </button>
          <input
            ref={colorRef}
            type="color"
            className="accent-color-input"
            value={/^#[0-9A-Fa-f]{6}$/.test(currentAccent) ? currentAccent : '#2F5D50'}
            onChange={(e) => {
              const hex = e.target.value
              onAddCustomAccent?.(hex)
            }}
            aria-label="自定义颜色"
          />
        </div>
      </section>

      {KIND_META.map(({ key, label, optionalKey }) => {
        const list = byKind[key] || []
        const enabled = optionalKey ? Boolean(optionalPages[optionalKey]) : true
        const disabled = optionalKey ? !enabled : false
        return (
          <section key={key} className={'theme-block' + (disabled ? ' is-disabled' : '')}>
            <div className="theme-block-h">
              <span className="theme-block-label">{label}</span>
              {optionalKey ? (
                <label className={'opt-inline' + (enabled ? ' on' : '')}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) =>
                      onChangeOptional?.({ ...optionalPages, [optionalKey]: e.target.checked })
                    }
                  />
                  可选
                </label>
              ) : null}
            </div>
            <div className="layout-picker" role="listbox" aria-label={label}>
              {list.map((d) => {
                const on = (designs[key] || list[0]?.id) === d.id
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={disabled}
                    className={'layout-card' + (on ? ' on' : '')}
                    style={on ? { '--card-accent': currentAccent } : undefined}
                    title={d.name}
                    onClick={() => onChangeDesign?.(key, d.id)}
                  >
                    <DesignPreview kind={key} design={d} accent={currentAccent} />
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
