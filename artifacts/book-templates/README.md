# Book Templates — Holistic Growth Life Path Book

This directory holds the PDF templates the printed book is built from. The
rendering pipeline ([templatedPdf/](../api-server/src/routes/zodiac-orders/templatedPdf/))
pulls templates from this folder, fills the AcroForm placeholder fields with
personalized content from the AI prompt output, and emits a ready-to-print
PDF for Lulu.

> **For Claude / future agents:** Read this file before generating a new book.
> [manifest.json](manifest.json) is the same information in machine-readable
> form — load it from code instead of hard-coding paths or placeholder names.

## Print spec

All templates target Lulu pod package `0600X0900FCSTDHC060CW444GXX`
(US Trade hardcover, case wrap, full color, 60# paper).

| | Value | Notes |
|---|---|---|
| Trim size | 6.00 × 9.00 in (432 × 648 pt) | Final printed page |
| **PDF page size (with bleed)** | **6.25 × 9.25 in (450 × 666 pt)** | Build all pages to this |
| Bleed | 0.125 in on every edge | Already baked into 6.25 × 9.25 |
| Safe margin from PDF edge | 0.625 in (45 pt) | 0.5 in inside trim — keep all important text/art inside |
| Usable text area | 5.00 × 8.00 in | After the safe margin |

Backgrounds and decorative artwork can extend to the PDF edge to use the
bleed; anything that must not be cropped (text, key art) needs to stay inside
the safe margin.

## Template inventory

### Page-type templates (re-used for every customer)

All templates are **AcroForm-enabled PDFs**: each `{{PLACEHOLDER}}` is an
interactive text field, named exactly so the extractor can pick up its
position without any text parsing. Files end in `-editable.pdf` to
distinguish them from the legacy `{{NAME}}`-as-visible-text versions (the
originals can be deleted once the pipeline has stabilised).

Multi-occurrence placeholders use numeric suffixes (`BODY_PARAGRAPH_1`,
`_2`, `_3`); the extractor groups them under the bare name so the renderer
sees `slots.BODY_PARAGRAPH = [slot1, slot2, slot3]` in top-to-bottom order.

| File | Page type | Facing | Form fields | Used for |
|---|---|---|---|---|
| `01-chapter-opener-editable.pdf` | Chapter Opener | recto | `CH_NUM`, `CHAPTER_TITLE`, `CHAPTER_SUBTITLE`, `PAGE_NUMBER` | First page of a new chapter |
| `02-standard-body-editable.pdf` | Standard Body | verso | `CHAPTER_TITLE`, `LEAD_PARAGRAPH`, `SUBSECTION_HEADING_1..2`, `BODY_PARAGRAPH_1..3`, `READER_FIRST_NAME`, `BULLET_1..3`, `PAGE_NUMBER` | Workhorse text page — first content page of each chapter |
| `03-standard-body-with-quotes-editable.pdf` | Body w/ Pull Quote | recto | `READER_FIRST_NAME`, `SUBSECTION_HEADING`, `BODY_PARAGRAPH_1..4`, `CHAPTER_TITLE`, `PULL_QUOTE`, `PAGE_NUMBER` | Body page that highlights one key line |
| `04-data-numerology-editable.pdf` | Data Card | verso | `CHAPTER_TITLE`, `INTERPRETATION_BODY_1..2`, `READER_FIRST_NAME`, `NUMBER`, `ARCHETYPE_NAME`, `CALCULATION`, `ELEMENT_1..2`, `KEYWORDS_1..2`, `SHADOW`, `SIGN`, `SIGN_GLYPH`, `HOUSE`, `PAGE_NUMBER` | Numerology / placement stats card |
| `05-affirmations-editable.pdf` | Affirmation Feature | either | `AFFIRMATION_TEXT`, `READER_FIRST_NAME`, `PLACEMENT_REFERENCE`, `CHAPTER_TITLE`, `PAGE_NUMBER` | Single focal affirmation page |
| `06-section-divider-editable.pdf` | Section Divider | full-bleed | `PART_NUM_1..2`, `PART_TITLE`, `READER_FIRST_NAME`, `PART_TAGLINE`, `PAGE_NUMBER` | Between major parts of the book |
| `07-body-continued-editable.pdf` | Body Continued | either | `READER_FIRST_NAME`, `CHAPTER_TITLE`, `BODY_PARAGRAPH_1..4`, `SUBSECTION_HEADING_1`, `PAGE_NUMBER` | Continuation prose page when chapter content overruns the standard-body layout |
| `welcome-letter-editable.pdf` | Welcome Letter | recto | `READER_FIRST_NAME`, `WELCOME_BODY_PARAGRAPH_1..2`, `WELCOME_SIGNOFF_LINE`, `WELCOME_SIGNATURE`, `WELCOME_FOOTER`, `DISCLAIMER_TEXT` | Opening "Welcome from the Cosmos" letter at the very front of the book |
| `closing-letter-editable.pdf` | Closing Letter | recto | `READER_FIRST_NAME`, `SUN_SIGN`, `MOON_SIGN`, `RISING_SIGN`, `LIFE_PATH`, `PERSONAL_YEAR`, `CLOSING_BODY_PARAGRAPH_1..3`, `CLOSING_FOOTER` | "A Love Letter from the Universe" — final page |

All page-type templates are **single page**, sized **450 × 666 pt** (6.25 × 9.25 in).

### Zodiac archetype templates (one per sign — chosen by the customer's data)

| Sign | File | Pages |
|---|---|---|
| Aries | `zodiac-name-aries.pdf` | 2 |
| Taurus | `zodiac-name-taurus.pdf` | 2 |
| Gemini | `zodiac-name-gemini.pdf` | 2 |
| Cancer | `zodiac-name-cancer.pdf` | 2 |
| Leo | `zodiac-name-leo.pdf` | 2 |
| Virgo | `zodiac-name-virgo.pdf` | 2 |
| Libra | `zodiac-name-libra.pdf` | 2 |
| Scorpio | `zodiac-name-scorpio.pdf` | 2 |
| Sagittarius | `zodiac-name-sagittarius.pdf` | 2 |
| Capricorn | `zodiac-name-capricorn.pdf` | 2 |
| Aquarius | `zodiac-name-aquarius.pdf` | 2 |
| Pisces | `zodiac-name-pisces.pdf` | 2 |

Page 1 of each zodiac template displays the sign name visually (e.g.
"YOUR SUN SIGN IS · ARIES"). Page 2 is intentionally blank/decorative. The
templates have no placeholders — the sign is baked into the artwork. Choose
the template by the customer's `sunSign` field.

## Chapter → template recipe

The AI prompt at [index.ts:265](../api-server/src/routes/zodiac-orders/index.ts#L265)
emits 12 chapters plus a Welcome Letter and a Closing letter. Default rendering
sequence (each row is one template page in the final PDF, in order):

| Section | Template sequence |
|---|---|
| Welcome Letter | `welcome-letter` (1 page) |
| **Part I — Foundations** | `06-section-divider` (PART I) |
| Chapter 1 — Your Life Path Overview | `01-chapter-opener` → `02-standard-body` (×N to fit) → `03-standard-body-with-quotes` (×1) |
| Chapter 2 — Your Sun Sign | `01-chapter-opener` → **`zodiac-name-{sun}`** (1 page from the matching template) → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 3 — Your Moon Sign | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 4 — Your Rising Sign | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| **Part II — Three Pillars** | `06-section-divider` (PART II) |
| Chapter 5 — Relationships | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` → `05-affirmations` (×1, signature affirmation only) |
| Chapter 6 — Wealth | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` → `05-affirmations` (×1) |
| Chapter 7 — Health | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` → `05-affirmations` (×1) |
| **Part III — Practice** | `06-section-divider` (PART III) |
| Chapter 8 — Numerological Fortune | `01-chapter-opener` → `04-data-numerology` (Life Path card) → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 9 — Planetary Influences | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 10 — Daily Mantras | `01-chapter-opener` → `05-affirmations` (Morning) → `05-affirmations` (Midday) → `05-affirmations` (Evening) |
| Chapter 11 — Sacred Morning Ritual | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 12 — Year Ahead | `01-chapter-opener` → `02-standard-body` (×N) → `04-data-numerology` (Personal Year card) → `03-standard-body-with-quotes` |
| Closing Letter | `closing-letter` (1 page) |

**`02-standard-body` repeats as needed.** When a chapter's body text overflows
one page, repeat `02-standard-body` and continue the prose. The pipeline must
measure rendered text against the template's body bounding box (see "Text
flow" below) to know when to break.

## Placeholder reference

Every `{{PLACEHOLDER}}` token in the templates and where its value comes from:

| Placeholder | Type | Source / how to fill |
|---|---|---|
| `READER_FIRST_NAME` | text | First whitespace-split token of `order.fullName` |
| `CH_NUM` | text | Chapter number, two-digit (e.g. `01`, `12`) |
| `CHAPTER_TITLE` | text | Heading after `# Chapter N:` from generated markdown — strip the `Chapter N:` prefix |
| `CHAPTER_SUBTITLE` | text | The em-dash-separated tail of the heading, or a hand-curated subtitle per chapter |
| `LEAD_PARAGRAPH` | paragraph | First paragraph of the chapter body — the orienting opener |
| `SUBSECTION_HEADING` | text | Each `## ` heading inside the chapter, in order. Template has 2 slots — first two subsections only |
| `BODY_PARAGRAPH` | multi-paragraph | The chapter body prose, flowed across one or more `02-standard-body` pages |
| `BULLET_1` / `BULLET_2` / `BULLET_3` | text | Three short, scannable summary lines drawn from the chapter — synthesized by the model when asked, or extracted from `## ` subsection openers |
| `PULL_QUOTE` | text | One striking sentence pulled from the chapter prose. Curate from a `> ` blockquote in the markdown if present, or pick the model's strongest single line |
| `AFFIRMATION_TEXT` | text | One affirmation. For Chapters 5/6/7: pick the signature line from `## Your 10 [Pillar] Affirmations`. For Chapter 10: each of Morning/Midday/Evening mantras |
| `PLACEMENT_REFERENCE` | text | Astrological context for the affirmation, e.g. `Venus in Libra` or `Life Path 7` |
| `INTERPRETATION_BODY` | paragraph | Plain-language interpretation of the data card |
| `NUMBER` | text | The numerology value (e.g. `7` for Life Path 7) |
| `ARCHETYPE_NAME` | text | Numerology archetype label (e.g. `The Seeker`) |
| `CALCULATION` | text | One-line breakdown of how the number was derived |
| `ELEMENT` | text | Astrological element when relevant (Fire / Earth / Air / Water) |
| `KEYWORDS` | text | Comma-separated keywords, ≤4 |
| `SHADOW` | text | Short shadow-pattern description |
| `SIGN` | text | Zodiac sign name (e.g. `Leo`) |
| `HOUSE` | text | House placement (e.g. `5th House`) |
| `PART_NUM` | text | Roman numeral for the part (`I`, `II`, `III`) |
| `PART_TITLE` | text | Part name (`Foundations`, `Three Pillars`, `Practice`) |
| `PART_TAGLINE` | text | One-line tagline shown on the divider page |

## Markdown → placeholder parsing rules

The AI prompt outputs structured markdown. Conversion rules for the renderer:

1. Split on `# Chapter N:` headings to get 12 chapter blocks (plus the
   pre-chapter "Welcome" block and the post-Chapter-12 "Closing" block).
2. For each chapter, the heading text after `Chapter N: ` is `CHAPTER_TITLE`.
   If it contains an em-dash (`—`), split on it: left side becomes the title,
   right side becomes `CHAPTER_SUBTITLE`. Otherwise leave subtitle blank.
3. The first paragraph after the `#` heading is `LEAD_PARAGRAPH`.
4. Each `## ` inside the chapter is a `SUBSECTION_HEADING`; the prose
   following it accumulates into `BODY_PARAGRAPH`.
5. For Chapters 5/6/7, the `## Your 10 [Pillar] Affirmations` section is
   parsed as a numbered list (lines beginning `1.`–`10.`). The first one
   becomes the chapter's `AFFIRMATION_TEXT` for the closing
   `05-affirmations.pdf` page; the remaining nine appear inline in the body.
6. For Chapter 10, the `## Morning`, `## Midday`, `## Evening` subheadings
   each contribute three mantras to one `05-affirmations.pdf` page.
7. `PULL_QUOTE`: pick the first markdown blockquote (`> ...`) in the chapter.
   If none, use the model's most striking single sentence — heuristic:
   shortest sentence with a first-person pronoun, or the last sentence of
   `LEAD_PARAGRAPH`.

## Text flow (when prose overruns the body slot)

`02-standard-body` has 3 `BODY_PARAGRAPH` slots interleaved with bullets and
a second subsection heading; `07-body-continued` has 4 `BODY_PARAGRAPH` slots
stacked vertically with no decoration between them. Both fit Cormorant
Garamond at 11.5pt with 1.55 leading (~17.8pt line height).

The renderer flows a chapter's prose like this:

1. **First page (`02-standard-body`):** fill `LEAD_PARAGRAPH`, the two
   `SUBSECTION_HEADING_*` slots, three `BULLET_*` lines, and `BODY_PARAGRAPH_1..3`.
   Each body paragraph is pinned to its slot's baseline — the template's
   bullet band and second subsection heading sit between body slots, so the
   visible spacing follows the template design.
2. **Continuation pages (`07-body-continued`):** subsequent paragraphs spill
   onto one or more body-continued pages. On these pages, paragraph 1 is
   anchored at `BODY_PARAGRAPH_1.y`, and **every subsequent paragraph stacks
   directly below the previous one** with a constant 14pt gap (plus one
   line of leading) instead of pinning to its own slot's baseline. This is
   why slot.y values for `BODY_PARAGRAPH_2..4` on body-continued are
   effectively only used as the *first* paragraph's start — the rest flow
   dynamically. The page caps at the safe bottom margin (45pt above the
   PDF edge).
3. Loop body-continued pages until the chapter's prose is exhausted.
4. **Pull-quote page (`03-standard-body-with-quotes`):** typically the last
   page of a chapter. The renderer measures the pull quote's actual height
   (auto-shrunk to fit 4 lines max), then sizes the above-quote and
   below-quote body zones around the rendered quote. Body paragraphs that
   don't fit cleanly spill onto further `07-body-continued` pages with the
   same chapter header.

### Per-template renderer quirks

A few intentional behaviours to know about (defined in
[`render.ts`](../api-server/src/routes/zodiac-orders/templatedPdf/render.ts)):

- **Header pillar label.** On every body-page header band (the top-right
  `CHAPTER_TITLE` slot, ~190pt wide), the renderer shows just the pillar
  name — `HEALTH` / `WEALTH` / `RELATIONSHIPS` — derived by splitting the
  chapter title on its em-dash. The chapter-opener page still shows the
  full centered title.
- **`xIndent` on `BULLET_1..3`.** The standard-body template draws a gold
  ★ glyph at the bullet's slot.x as part of the page artwork. The renderer
  shifts bullet text 32pt to the right (`xIndent: 32`) to clear the glyph.
- **`autoShrink` on `CHAPTER_TITLE` / `READER_FIRST_NAME`.** Header band
  slots are narrow; long titles auto-shrink in 0.5pt steps down to a
  per-style minimum, then ellipsis-truncate as a last resort. Chapter-opener
  uses a higher minimum (14pt) since it's the centered big title.
- **Force-masked `SUBSECTION_HEADING` on `07-body-continued`.** The template
  draws a small ★ glyph in the page artwork at (~47, 324) — *outside* the
  AcroForm widget rectangle (which starts at x=56). The renderer paints a
  cream rectangle over this band before flowing paragraphs so a paragraph
  that happens to flow through y=322 doesn't collide with the marker.
- **Dynamic pull-quote sizing on `03-standard-body-with-quotes`.** The
  template's 4 `BODY_PARAGRAPH` slots are really 2 zones (above/below the
  decorative quote band). The renderer (`buildPullQuotePage`):
  1. **Auto-shrinks the quote font** in 0.5pt steps (from 16pt down to 11pt
     min) until the wrapped quote is at most 6 lines.
  2. **Quote positioned BELOW the decorative band.** The template has
     a fixed pull-quote band at PDF y≈435-478 (two horizontal gold rules
     with ★ markers at `(225, 473)` and `(225, 455)`). The space between
     the rules is only ~43pt — too tight for a long quote at readable
     size. The renderer sets `QUOTE_CENTER_Y = 365`, placing the quote
     entirely below the bottom rule. The decorative band stays visible
     above the quote as a small ornament between the subsection heading
     and the quote text. No masking needed since the quote never
     intersects the rules or ★ glyphs.
  3. **Sizes body zones around the actual quote extent**, not the template's
     fixed band — so a long quote pushes body paragraphs out of the way
     instead of overlapping them.
  4. **Stacks paragraphs dynamically** inside each zone (same 14pt gap +
     leading as body-continued), only drawing whole paragraphs that fit.
  5. **Returns `{ consumed, total }`** so callers can spill the remaining
     paragraphs onto `07-body-continued` pages.

## Smoke testing per template

Render a single template page with mock content to iterate visually
without regenerating the full 49-page book:

```bash
pnpm --filter @workspace/api-server run smoke-template -- <id>
```

Valid `<id>`s: `chapter-opener`, `standard-body`, `standard-body-with-quotes`,
`data-numerology`, `affirmations`, `section-divider`, `body-continued`,
`welcome-letter`, `closing-letter`, plus `body-stress` (5+ pages of
standard-body + body-continued with a long mock chapter — exercises the
text-flow path).

Output writes to `test-output/test-<id>.pdf`. **Quit Preview entirely (Cmd+Q)
before reopening** — Preview caches recently-viewed PDFs and can show a stale
render even after the file changes.

## Implementation status

| Piece | Status |
|---|---|
| Templates uploaded (AcroForm-enabled) | ✅ |
| Placeholder vocabulary documented | ✅ this file + `manifest.json` |
| Chapter → template recipe | ✅ this file + `manifest.json` |
| Markdown parsing rules | ✅ this file + [parse.ts](../api-server/src/routes/zodiac-orders/templatedPdf/parse.ts) |
| Coordinate extraction (where each placeholder lives on the page) | ✅ via [scripts/src/extract-template-slots.ts](../../scripts/src/extract-template-slots.ts) — slots committed to `manifest.json` |
| Render pipeline (manifest → embed template → fill AcroForm slots → strip widgets → flat PDF) | ✅ in [templatedPdf/](../api-server/src/routes/zodiac-orders/templatedPdf/) |
| Replacement of pdfkit-based `generateInteriorPDF` | ✅ — delegates to `generateTemplatedInteriorPDF` |
| Per-template smoke tests | ✅ `pnpm --filter @workspace/api-server run smoke-template -- <id>` (see "Smoke testing per template" above) |
| Multi-page text flow | ✅ standard-body + body-continued with dynamic paragraph stacking on continuation pages |
| Header pillar label, autoShrink, bullet xIndent, body-continued ★ mask | ✅ in `STYLES` and `buildBodyContinuedPage` |
| Cormorant Garamond fonts | ⏳ optional — drop OFL `.ttf` files into [fonts/](fonts/) for typography parity. Falls back to Times if absent |
| Visual QA on each template | 🟡 in progress — section-divider, chapter-opener, standard-body, body-continued, standard-body-with-quotes reviewed; data-numerology, affirmations, welcome-letter, closing-letter pending |
| Hardcover wrap (`00-hardcover-editable.pdf`) wired into cover-generation pipeline | ⏳ separate code path; cover is generated by `generateCoverPDF`, not the templated interior pipeline |

### Slot coordinate format

Each entry in `manifest.json` `pageTypes.<key>.slots.<PLACEHOLDER>` looks like:

```json
{ "x": 45.5, "y": 570, "w": 92.09, "h": 8.5, "fontSize": 8.5, "fontName": "g_d1_f2" }
```

- `x`, `y` — **PDF user units** (origin at the BOTTOM-LEFT of the page,
  Y grows upward). `(x, y)` is the baseline-left of the placeholder text run.
- `w`, `h` — width/height of the placeholder text run itself. Useful as a
  hint for slot extent, but the renderer should size personalized text using
  the surrounding column width (typically 5 in / 360 pt) rather than `w`.
- `fontSize` — the placeholder text's own size (always 8.5 pt for these
  templates — placeholders are deliberately small). The renderer should pick
  the body/heading/lead size based on the placeholder *name*, not this
  number. The placeholder's small size is just a visual hint to the designer.
- `fontName` — pdfjs-dist's internal font handle (e.g. `g_d1_f2`). Not
  meaningful to downstream code; kept for diagnostics.

If a placeholder appears more than once on a page, the value is an **array**
of slot objects in the order they appear. Currently:

- `02-standard-body.pdf` → `SUBSECTION_HEADING` is an array of 2 (the
  template has two subsection slots — the renderer fills the first two
  `## ` headings of the chapter).
- `06-section-divider.pdf` → `PART_NUM` is an array of 2 (small header
  "PART I" + the large center "PART I" callout — renderer must fill both
  with the same value).

### Re-running the extractor

If you edit a template (move a placeholder, add a new one, change the
copy), re-run:

```bash
pnpm --filter @workspace/scripts run extract-template-slots
```

The script regenerates `manifest.json`'s `slots` blocks and warns about
drift between declared `placeholders` arrays and the actual extracted
tokens (e.g. extra placeholders found in the PDF that weren't in the list).

### How the pipeline runs (current)

1. **Load** `manifest.json` once per render call (`loadManifest`).
2. **Parse** the AI-generated markdown into structured chapter blocks
   (`parseBook` — see [parse.ts](../api-server/src/routes/zodiac-orders/templatedPdf/parse.ts)).
3. **Walk `chapterRecipes`** in order. For each step:
   - Embed the template page via `pdf-lib`'s `embedPdf` + `drawPage`.
   - For each AcroForm-extracted slot, draw the personalized content at the
     slot's `(x, y)` using the `STYLES` preset chosen by the placeholder's
     **name** (not by the placeholder's own font size — that's just a
     designer hint).
   - Multi-paragraph prose that overruns one `02-standard-body` page spills
     onto consecutive `07-body-continued` pages with dynamic stacking
     (see "Text flow" above).
4. **Two-pass TOC.** A blank page is reserved at recipe step `{section: toc}`
   and filled at the end once every chapter's start page number is known.
5. **Strip widgets.** After every page is drawn, the renderer calls
   `form.removeField()` on every AcroForm field so the output is a flat,
   non-interactive print PDF.

## Known issues / questions for the designer

### Pending: re-export all `-editable.pdf` templates with transparent widget fills

**All currently-uploaded `-editable.pdf` templates need to be re-exported from
Claude.ai with the AcroForm widget fill colour set to TRANSPARENT (or
matching the exact page-bg cream `rgb(245, 241, 232)`).** The current export
bakes a slightly-darker cream rectangle (`rgb(245, 240, 229)`) into the
page raster at every widget position. These rectangles read as visible
"cutout boxes" on the rendered page — one per placeholder — and cannot be
cleanly masked from code because the template raster has a subtle gradient
(no single flat colour matches every region's surrounding page bg).
Affects: header bands (`READER_FIRST_NAME` / `CHAPTER_TITLE`),
`SUBSECTION_HEADING`, every `BODY_PARAGRAPH_*`, `PULL_QUOTE`, and the ★
badges in `03-standard-body-with-quotes`'s decorative band. After
re-export, the only visible elements should be the intentional decorative
artwork (gold rules, ★ glyphs on the pull-quote page) — no widget-bg
rectangles.

- **`07-body-continued` has a stray ★ glyph at (47, 324)** drawn outside the
  `SUBSECTION_HEADING_1` AcroForm widget rectangle. The renderer covers it
  with a cream rectangle (`buildBodyContinuedPage` → force-mask), but the
  cleaner fix is to remove or align the glyph inside the widget when next
  iterating the template in Claude.ai.
- **`closing-letter.pdf` has a typo:** the `{{PERSONAL_YEAR` token is missing
  its closing `}}` and won't be detected by the extractor until fixed in the
  design tool. The renderer skips this slot for now.
- **Last page of a chapter often has a large bottom gap** when the prose
  ends well above slot[3]. Two fixes worth considering — (a) prompt the AI
  to target ~2200–2400 characters per chapter so paragraphs reliably fill
  4 body-continued slots, or (b) add a decorative glyph (planet,
  constellation, moon phase) at y≈80–120 of `07-body-continued-editable.pdf`
  so the tail space gets a visual closer.
- **Cover & back cover** are generated separately
  (`generateCoverPDF` in [pdfGenerator.ts](../api-server/src/routes/zodiac-orders/pdfGenerator.ts)).
  The `00-hardcover-editable.pdf` is uploaded but not yet wired into the
  cover pipeline; templating the cover would let the customer's name &
  birth chart sit on the wrap.
- **Moon-sign and Rising-sign** don't have analogous archetype templates —
  only the Sun sign gets the visual treatment (the zodiac templates say
  "YOUR SUN SIGN IS"). If you want the same visual reverence for Moon and
  Rising, the designer would need to produce parallel sets, or relabel the
  existing 12 to be sign-agnostic.
- **The AI prompt** uses `# Chapter N:` for chapter headings (per the
  template at [index.ts:289+](../api-server/src/routes/zodiac-orders/index.ts#L289))
  while the formatting instructions earlier in the same prompt say to use
  `##` for main chapters. The two contradict; the chapter-outline form (`#`)
  wins in the actual emitted output, so the parser splits on `# `.
