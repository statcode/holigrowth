# Book Templates — Holistic Growth Life Path Book

This directory holds the PDF templates the printed book is built from. The
rendering pipeline (in [pdfGenerator.ts](../api-server/src/routes/zodiac-orders/pdfGenerator.ts))
should pull templates from this folder, fill the `{{PLACEHOLDER}}` tokens with
personalized content from the AI prompt output, and emit a ready-to-print PDF
for Lulu.

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

| File | Page type | Facing | Placeholders | Used for |
|---|---|---|---|---|
| `01-chapter-opener.pdf` | Chapter Opener | recto | `CH_NUM`, `CHAPTER_TITLE`, `CHAPTER_SUBTITLE` | First page of a new chapter |
| `02-standard-body.pdf` | Standard Body | verso | `CHAPTER_TITLE`, `LEAD_PARAGRAPH`, `SUBSECTION_HEADING` (×2), `BODY_PARAGRAPH`, `READER_FIRST_NAME`, `BULLET_1`, `BULLET_2`, `BULLET_3` | Workhorse text page |
| `03-standard-body-with-quotes.pdf` | Body w/ Pull Quote | recto | `READER_FIRST_NAME`, `SUBSECTION_HEADING`, `BODY_PARAGRAPH`, `CHAPTER_TITLE`, `PULL_QUOTE` | Body page that highlights one key line |
| `04-data-numerology.pdf` | Data Card | verso | `CHAPTER_TITLE`, `INTERPRETATION_BODY`, `READER_FIRST_NAME`, `NUMBER`, `ARCHETYPE_NAME`, `CALCULATION`, `ELEMENT`, `KEYWORDS`, `SHADOW`, `SIGN`, `HOUSE` | Numerology / placement stats card |
| `05-affirmations.pdf` | Affirmation Feature | either | `AFFIRMATION_TEXT`, `READER_FIRST_NAME`, `PLACEMENT_REFERENCE`, `CHAPTER_TITLE` | Single focal affirmation page |
| `06-section-divider.pdf` | Section Divider | full-bleed | `PART_NUM`, `PART_TITLE`, `READER_FIRST_NAME`, `PART_TAGLINE` | Between major parts of the book |

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
| Welcome Letter | `02-standard-body` (1 page) |
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
| Closing Letter | `03-standard-body-with-quotes` (1 page) |

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

The body slot in `02-standard-body.pdf` fits roughly 36–40 lines of
Cormorant Garamond at 11.5pt with 1.55 leading — about 350–400 words.
When a chapter's `BODY_PARAGRAPH` exceeds that, the renderer should:

1. Measure how much fits in the current page's body bounding box.
2. Emit that page, then start another `02-standard-body.pdf` with the
   remaining text and an empty `LEAD_PARAGRAPH` / `BULLET_*` slot
   (continuation pages don't repeat the lead or bullets).
3. Repeat until the chapter is exhausted, then move to the next template
   in the chapter recipe.

The bounding boxes for each placeholder slot are TBD pending coordinate
extraction (see "Implementation status" below).

## Implementation status

| Piece | Status |
|---|---|
| Templates uploaded | ✅ in this folder |
| Placeholder vocabulary documented | ✅ this file + `manifest.json` |
| Chapter → template recipe | ✅ this file + `manifest.json` |
| Markdown parsing rules | ✅ this file |
| Coordinate extraction (where each placeholder lives on the page) | ✅ via [scripts/src/extract-template-slots.ts](../../scripts/src/extract-template-slots.ts) — slots committed to `manifest.json` |
| Render pipeline (read manifest → embed template → fill placeholders → emit PDF) | ✅ in [api-server/src/routes/zodiac-orders/templatedPdf/](../api-server/src/routes/zodiac-orders/templatedPdf/) |
| Replacement of pdfkit-based `generateInteriorPDF` | ✅ — `generateInteriorPDF` now delegates to `generateTemplatedInteriorPDF`. Old pdfkit-from-scratch impl kept as `generateInteriorPDFLegacy` (unused but available as a fallback) |
| Cormorant Garamond fonts | ⏳ optional — drop OFL `.ttf` files into [fonts/](fonts/) for typography parity. Falls back to Times if absent |
| Visual tuning (font sizes, colors, masking) | ⏳ first pass shipped — open `/tmp/test-templated.pdf` after `pnpm --filter @workspace/api-server run smoke-pdf` and adjust [`STYLES`](../api-server/src/routes/zodiac-orders/templatedPdf/render.ts) + page bg colours from there |

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

### Render pipeline — what's left

The pipeline that consumes this manifest and produces a printed PDF still
needs to be built. It will:

1. Load `manifest.json` once at startup.
2. Parse the AI-generated markdown into structured chapter blocks per the
   rules in [Markdown → placeholder parsing rules](#markdown--placeholder-parsing-rules).
3. For each step in `chapterRecipes`:
   - Embed the template page via `pdf-lib` `embedPage`.
   - For each placeholder slot, draw a fill-rectangle in the page's
     background color to mask the visible `{{NAME}}` text, then draw the
     personalized content at the slot's `(x, y)` using the appropriate font
     and size for that placeholder name (chosen by the renderer, not the
     placeholder's own 8.5 pt).
   - For prose slots (`BODY_PARAGRAPH`, `LEAD_PARAGRAPH`,
     `INTERPRETATION_BODY`) that overrun their column, page-break and
     repeat `02-standard-body.pdf` until the chapter is exhausted.
4. Output a single Lulu-ready interior PDF.

Open question before that pipeline lands: which font(s) to embed for the
personalized text. The templates use Cormorant Garamond (regular, bold,
italic). To match exactly, those `.ttf` / `.otf` files need to live somewhere
the api-server can read at runtime. Alternative: embed Helvetica/Times
fallbacks (already inside pdf-lib's standard fonts) and accept a slight
visual mismatch with the template's typography. Worth a call before I start.

## Known issues / questions for the designer

- **Welcome Letter & Closing Letter** don't have dedicated templates yet.
  Currently the recipe routes Welcome through `02-standard-body` (no chapter
  number) and Closing through `03-standard-body-with-quotes`. Worth a custom
  `welcome-letter.pdf` and `closing-letter.pdf` if you want them framed
  differently from chapter bodies.
- **Cover & back cover** are generated separately
  (`generateCoverPDF` in [pdfGenerator.ts](../api-server/src/routes/zodiac-orders/pdfGenerator.ts)).
  If you want the cover template-driven too, that's a separate template
  (different dimensions: 6.25 × 9.25 doesn't apply — case wrap covers are
  larger and include spine + back).
- **Moon-sign and Rising-sign** don't have analogous archetype templates —
  only the Sun sign gets the visual treatment (the zodiac templates say
  "YOUR SUN SIGN IS"). If you want the same visual reverence for Moon and
  Rising, the designer would need to produce parallel sets, or relabel the
  existing 12 to be sign-agnostic.
- **The AI prompt** uses `# Chapter N:` for chapter headings (per the
  template at [index.ts:289+](../api-server/src/routes/zodiac-orders/index.ts#L289))
  while the formatting instructions earlier in the same prompt say to use
  `##` for main chapters. The two contradict; the chapter-outline form (`#`)
  wins in the actual emitted output, so the parser should split on `# `.
