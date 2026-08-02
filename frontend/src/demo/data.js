import { DEMO_PROJECT_ID } from './mode.js'

/** Simple 16:9 SVG slide preview as data URI */
function slideSvg({ title, subtitle, accent = '#2F5D50', page = 1 }) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#FAFBFA"/>
  <rect x="0" y="0" width="1280" height="8" fill="${accent}"/>
  <text x="72" y="96" font-family="Segoe UI, sans-serif" font-size="18" fill="${accent}" font-weight="600">${page}</text>
  <text x="72" y="160" font-family="Segoe UI, sans-serif" font-size="36" fill="#1A2E28" font-weight="600">${escapeXml(title)}</text>
  <text x="72" y="220" font-family="Segoe UI, sans-serif" font-size="20" fill="#4A5C56">${escapeXml(subtitle || '')}</text>
  <rect x="72" y="280" width="520" height="14" rx="4" fill="#E4EDE9"/>
  <rect x="72" y="312" width="480" height="14" rx="4" fill="#E4EDE9"/>
  <rect x="72" y="344" width="440" height="14" rx="4" fill="#E4EDE9"/>
  <rect x="720" y="260" width="480" height="320" rx="12" fill="#EEF5F2" stroke="${accent}" stroke-opacity="0.35"/>
  <text x="760" y="420" font-family="Segoe UI, sans-serif" font-size="22" fill="${accent}">示意图位</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function figSvg(label, accent = '#2F5D50') {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#F4F8F6"/>
  <circle cx="220" cy="240" r="70" fill="${accent}" fill-opacity="0.2" stroke="${accent}" stroke-width="3"/>
  <circle cx="360" cy="240" r="70" fill="${accent}" fill-opacity="0.35" stroke="${accent}" stroke-width="3"/>
  <path d="M280 240 H300" stroke="${accent}" stroke-width="4"/>
  <text x="320" y="420" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="#1A2E28">${escapeXml(label)}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const DEMO_OUTLINE = {
  schema_version: '1.0.0',
  project_id: DEMO_PROJECT_ID,
  updated_at: '2026-08-01T12:00:00Z',
  status: 'user_confirmed',
  course_title: 'Wnt/β-catenin 信号通路',
  subject: 'biology',
  audience: '本科三年级 · 细胞生物学',
  target_minutes: 50,
  sections: [
    {
      section_id: 'SEC01',
      title: '通路的分子框架',
      order: 1,
      estimated_minutes: 28,
      knowledge_points: [
        {
          kp_id: 'KP01',
          title: '四类核心组分',
          learning_objective: '列出配体、受体、胞质效应因子与转录输出',
          order: 1,
          must_cover: true,
          teaching_beats: [
            { beat_id: 'B01', title: '配体与受体', intent: 'explain', order: 1, needs_figure: true },
            { beat_id: 'B02', title: 'β-catenin 开关', intent: 'explain', order: 2, needs_figure: true },
          ],
        },
        {
          kp_id: 'KP02',
          title: '破坏复合物',
          learning_objective: '描述无信号时 β-catenin 如何被清除',
          order: 2,
          must_cover: true,
          teaching_beats: [
            { beat_id: 'B03', title: '降解机制', intent: 'explain', order: 1, needs_figure: true },
          ],
        },
      ],
    },
    {
      section_id: 'SEC02',
      title: '通路异常与疾病',
      order: 2,
      estimated_minutes: 22,
      knowledge_points: [
        {
          kp_id: 'KP03',
          title: 'APC 与结直肠癌',
          learning_objective: '解释 APC 缺失如何导致通路组成性激活',
          order: 1,
          must_cover: true,
          teaching_beats: [
            { beat_id: 'B04', title: '临床关联', intent: 'apply', order: 1, needs_figure: false },
          ],
        },
      ],
    },
  ],
}

export const DEMO_SOURCES = {
  project_id: DEMO_PROJECT_ID,
  sources: [
    {
      source_id: 'S001',
      source_type: 'review',
      title:
        'Wnt/β-catenin signalling: function, biological mechanisms, and therapeutic opportunities',
      authors: ['Liu J', 'Xiao Q', 'Xiao J'],
      year: 2022,
      venue_or_publisher: 'Signal Transduction and Targeted Therapy',
      identifiers: { doi: '10.1038/s41392-021-00762-6' },
      quality_signals: { impact_factor: 39.3, jcr_quartile: 'Q1', citation_count: 1420 },
      user_confirmation: 'selected',
      abstract:
        'Comprehensive review of Wnt/β-catenin pathway components, regulation, and therapeutic angles.',
    },
    {
      source_id: 'S002',
      source_type: 'textbook',
      title: 'Molecular Biology of the Cell',
      authors: ['Alberts B'],
      year: 2022,
      venue_or_publisher: 'W. W. Norton',
      identifiers: {},
      quality_signals: { landmark: true },
      user_confirmation: 'selected',
      abstract: 'Textbook chapter framing of Wnt pathway for undergraduate teaching.',
    },
    {
      source_id: 'S003',
      source_type: 'research_article',
      title: 'Structural basis of Wnt recognition by Frizzled',
      authors: ['Janda C'],
      year: 2012,
      venue_or_publisher: 'Science',
      identifiers: { doi: '10.1126/science.1222879' },
      quality_signals: { impact_factor: 56.9, jcr_quartile: 'Q1' },
      user_confirmation: 'proposed',
      abstract: 'Structural study of Wnt–FZD interaction (demo: still proposed).',
    },
  ],
  counts: { total: 3, selected: 2, proposed: 1, rejected: 0 },
}

const FIG1 = figSvg('通路开关示意')
const FIG2 = figSvg('破坏复合物', '#3D7A6A')

export const DEMO_FIGURES = {
  project_id: DEMO_PROJECT_ID,
  figures: [
    {
      figure_id: 'F001',
      figure_kind: 'ai_scientific_illustration',
      figure_kind_zh: 'AI 科学示意图',
      used_on_pages: [{ page_index: 3, page_id: 'P03', page_title: '四类核心组分' }],
      used_on_label: '第3页',
      has_file: true,
      thumb_url: FIG1,
      caption: 'Wnt/β-catenin 关闭态与开启态示意（演示图）',
      caption_zh: 'Wnt/β-catenin 关闭态与开启态示意（演示图）',
    },
    {
      figure_id: 'F002',
      figure_kind: 'source_crop',
      figure_kind_zh: '论文裁图',
      source_id: 'S001',
      used_on_pages: [{ page_index: 4, page_id: 'P04', page_title: '破坏复合物' }],
      used_on_label: '第4页',
      has_file: true,
      thumb_url: FIG2,
      caption: '破坏复合物组成（演示图）',
      caption_zh: '破坏复合物组成（演示图）',
    },
  ],
  counts: {
    total: 2,
    with_file: 2,
    source_crop: 1,
    ai: 1,
    crop_total: 1,
    crop_done: 1,
    ai_total: 1,
    ai_done: 1,
  },
}

const SLIDE_DEFS = [
  { page_id: 'P01', role: 'title', title: 'Wnt/β-catenin 信号通路', sub: '本科三年级 · 50 分钟' },
  { page_id: 'P02', role: 'agenda', title: '本节议程', sub: '框架 → 开关 → 疾病关联' },
  { page_id: 'P03', role: 'content', title: '四类核心组分', sub: '配体 · 受体 · 效应因子 · 转录' },
  { page_id: 'P04', role: 'content', title: '破坏复合物', sub: '无信号时清除 β-catenin' },
  { page_id: 'P05', role: 'content', title: 'APC 与结直肠癌', sub: '组成性激活作为早期事件' },
  { page_id: 'P06', role: 'summary', title: '要点回顾', sub: '四层框架 + 临床钩子' },
]

export const DEMO_SLIDES = {
  project_id: DEMO_PROJECT_ID,
  count: SLIDE_DEFS.length,
  has_exports: true,
  slides: SLIDE_DEFS.map((s, i) => ({
    page_id: s.page_id,
    order: i + 1,
    page_role: s.role,
    page_title: s.title,
    key_message: s.sub,
    on_slide_text: [s.sub, '演示数据：可浏览流程与版式，不可真实检索/生图。'],
    export_thumb_url: slideSvg({ title: s.title, subtitle: s.sub, page: i + 1 }),
    figure_thumb_url: i === 2 ? FIG1 : i === 3 ? FIG2 : null,
    visual_plan: {
      selected_figure_id: i === 2 ? 'F001' : i === 3 ? 'F002' : null,
      resolution_status: s.role === 'content' ? 'resolved' : 'not_needed',
    },
  })),
}

export const DEMO_LECTURE = `# 配套讲稿（演示）

---

## P01 Wnt/β-catenin 信号通路

欢迎同学们。今天用 50 分钟把 Wnt 通路拆成可教学的四层框架。

---

## P03 四类核心组分

先建立空间位置：配体在胞外，受体在膜上，β-catenin 在胞质，转录在核内。

---

## P05 APC 与结直肠癌

把机制接到疾病：APC 缺失 → 破坏复合物失灵 → β-catenin 堆积。
`

export const DEMO_PROJECT = {
  id: DEMO_PROJECT_ID,
  project_id: DEMO_PROJECT_ID,
  course_title: 'Wnt/β-catenin 信号通路',
  audience: '本科三年级 · 细胞生物学',
  target_minutes: 50,
  theme_id: 'green',
  theme: { id: 'green', name: '松叶绿', accent: '#2F5D50', board: 'white' },
  page_designs: {
    title: 'plain',
    agenda: 'list',
    content: 'chapter',
    section: 'big_num',
    thanks: 'centered',
  },
  optional_pages: { section_dividers: false, thanks: false },
  artifacts: {
    'source/outline.json': true,
    'source/sources.json': true,
    'source/figure_catalog.json': true,
    'source/slide_plan.json': true,
    'deck/draft-with-images.pptx': true,
    'lecture_script.md': true,
  },
  gates: {
    gate1_outline: { status: 'confirmed' },
    gate2_sources: { status: 'confirmed' },
    gate3_evidence_visual: { status: 'confirmed' },
  },
}

export const DEMO_THEMES = {
  default: 'green',
  default_designs: {
    title: 'plain',
    agenda: 'list',
    content: 'chapter',
    section: 'big_num',
    thanks: 'centered',
  },
  themes: [
    { id: 'green', name: '松叶绿', accent: '#2F5D50', board: 'white' },
    { id: 'blue', name: '湖水蓝', accent: '#2F5D8A', board: 'white' },
    { id: 'terracotta', name: '陶土', accent: '#A65D3F', board: 'white' },
  ],
  designs: null,
}

export const DEMO_HEALTH = {
  ok: true,
  demo: true,
  deck_root: '(demo)',
  workspace: '(demo)',
  python: '(demo)',
  steps: ['generate_outline', 'retrieve', 'fill', 'export_slides', 'rerender_export'],
  providers: { text: false, image: false },
}

export const DEMO_PROVIDERS = {
  capabilities: { text: false, image: false, literature: false },
  text: { configured: false, provider: 'demo', model: '' },
  image: { configured: false, provider: 'demo', model: '' },
  literature: { configured: false },
}

export const DEMO_QA = {
  project_id: DEMO_PROJECT_ID,
  status: 'pass',
  summary: '演示项目：门禁样例均为通过（非真实校验）。',
  checks: [],
}
