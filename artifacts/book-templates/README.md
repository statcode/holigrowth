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
| `03-standard-body-with-quotes-editable.pdf` | Pull-Quote Highlight | recto | `READER_FIRST_NAME`, `CHAPTER_TITLE`, `SUBSECTION_HEADING`, `PULL_QUOTE`, `PAGE_NUMBER` | Dedicated quote-highlight page — chapter body prose is NOT rendered here (it lives on the preceding standard-body / body-continued pages). The page shows just the header band, the subsection heading, one centered pull quote, and a small gold ornament. |
| `04-data-numerology-editable.pdf` | Data Card | verso | `CHAPTER_TITLE`, `INTERPRETATION_BODY_1..2`, `READER_FIRST_NAME`, `NUMBER`, `ARCHETYPE_NAME`, `CALCULATION`, `ELEMENT_1..2`, `KEYWORDS_1..2`, `SHADOW`, `SIGN`, `SIGN_GLYPH`, `HOUSE`, `PAGE_NUMBER` | Numerology / placement stats card |
| `05-affirmations-editable.pdf` | Affirmation Feature | either | `AFFIRMATION_TEXT`, `READER_FIRST_NAME`, `PLACEMENT_REFERENCE`, `CHAPTER_TITLE`, `PAGE_NUMBER` | Affirmation page — renders **up to 5 affirmations stacked vertically** inside the `AFFIRMATION_TEXT` slot via `drawAffirmationList`. Falls back to a single focal-quote layout when only one item is passed. |
| `06-section-divider-editable.pdf` | Section Divider | full-bleed | `PART_NUM_1..2`, `PART_TITLE`, `READER_FIRST_NAME`, `PART_TAGLINE`, `PAGE_NUMBER` | Between major parts of the book |
| `07-body-continued-editable.pdf` | Body Continued | either | `READER_FIRST_NAME`, `CHAPTER_TITLE`, `BODY_PARAGRAPH_1..4`, `SUBSECTION_HEADING_1`, `PAGE_NUMBER` | Continuation prose page when chapter content overruns the standard-body layout |
| `welcome-letter-editable.pdf` | Welcome Letter | recto | `READER_FIRST_NAME`, `WELCOME_BODY_PARAGRAPH_1..2`, `WELCOME_SIGNOFF_LINE`, `WELCOME_SIGNATURE`, `WELCOME_FOOTER`, `DISCLAIMER_TEXT` | Opening "Welcome from the Cosmos" letter at the very front of the book |
| `closing-letter-editable.pdf` | Closing Letter | recto | `READER_FIRST_NAME`, `SUN_SIGN`, `MOON_SIGN`, `RISING_SIGN`, `LIFE_PATH`, `PERSONAL_YEAR`, `CLOSING_BODY_PARAGRAPH_1..3`, `CLOSING_FOOTER` | "A Love Letter from the Universe" — final page. **Dark template** (midnight purple bg `rgb(41, 35, 70)`, light-cream body text — see `PAGE_BG` / `PAGE_FG` in `render.ts`). |
| `zodiac-moon-editable.pdf` | Moon-Sign Feature | recto | `BOOK_TITLE`, `ZODIAC_NAME_MOON`, `ZODIAC_GLYPH_MOON`, `PAGE_NUMBER` | Chapter 3 — single dynamic template (one file for all 12 moon signs). Sign filled at render time from `order.moonSign`. `ZODIAC_GLYPH_MOON` is the small decorative flourish glyph between the bottom gold rules — drawn via `drawBigCenteredInRect` so the unicode zodiac symbol (or letter fallback) sits centred in the narrow band. |
| `zodiac-rising-editable.pdf` | Rising-Sign Feature | recto | `BOOK_TITLE`, `ZODIAC_NAME_RISING`, `ZODIAC_GLYPH_RISING`, `PAGE_NUMBER` | Chapter 4 — same layout as moon. Sign filled from `order.risingSign`. |
| `08-birthstone-editable.pdf` | Birthstone Feature (BONUS) | recto | `CHAPTER_TITLE`, `BIRTHSTONE_IMAGE`, `BIRTHSTONE_BODY`, `PAGE_NUMBER` | **Chapter 13 (BONUS)** — single dynamic template; the stone is resolved at render time from `order.birthday`'s month (Jan→Garnet, Feb→Amethyst, …Dec→Turquoise). `BIRTHSTONE_IMAGE` is filled with a PNG from `birthstones/<slug>.png` if present, otherwise the renderer draws a vector gemstone (filled circle in the stone's colour with a darker inner ring + a pearly highlight glint) so the page is never blank. `BIRTHSTONE_BODY` is laid out by `drawBirthstoneCaption` as the uppercase stone name (display weight) plus the gold italic tagline beneath. `CHAPTER_TITLE` is intentionally **not** filled — the template already bakes "YOUR BIRTHSTONE" into the top-left header band; filling the right-hand widget would produce a visible double-header. |

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

## AI prompt — single source of truth

The system prompt sent to the LLM that generates the book content lives in
[**book-prompt.md**](book-prompt.md) (this folder). It is loaded at runtime
by [`zodiac-orders/index.ts`](../api-server/src/routes/zodiac-orders/index.ts)
via `loadBookSystemPrompt()` and cached. **Edit `book-prompt.md` to tune
generation behavior** — don't inline prompt text in TypeScript.

The prompt contains the chapter outline (12 chapters + welcome + closing), the
audience/tone guidance, personalization requirements, and a dedicated
**Pull-Quote Requirement** section that instructs the model to end every
chapter with a single markdown blockquote (`> ...`). Those blockquotes are
extracted by [`parse.ts`](../api-server/src/routes/zodiac-orders/templatedPdf/parse.ts)
(`extractPullQuote()`) and rendered as the featured-quote page
(`03-standard-body-with-quotes`) at the end of each chapter's template sequence.

## Chapter → template recipe

The prompt emits 12 chapters plus a Welcome Letter and a Closing letter.
Default rendering sequence (each row is one template page in the final PDF,
in order):

| Section | Template sequence |
|---|---|
| Welcome Letter | `welcome-letter` (1 page) |
| **Part I — Foundations** | `06-section-divider` (PART I) |
| Chapter 1 — Your Life Path Overview | `01-chapter-opener` → `02-standard-body` (×N to fit) → `03-standard-body-with-quotes` (×1) |
| Chapter 2 — Your Sun Sign | `01-chapter-opener` → **`zodiac-name-{sun}`** (1 page from the matching template) → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 3 — Your Moon Sign | `01-chapter-opener` → **`zodiac-moon`** (single template, sign filled at render time from `order.moonSign`) → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 4 — Your Rising Sign | `01-chapter-opener` → **`zodiac-rising`** (single template, sign filled at render time from `order.risingSign`) → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| **Part II — Three Pillars** | `06-section-divider` (PART II) |
| Chapter 5 — Relationships | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` → `05-affirmations` (×1, first 5 affirmations stacked) |
| Chapter 6 — Wealth | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` → `05-affirmations` (×1, first 5 affirmations stacked) |
| Chapter 7 — Health | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` → `05-affirmations` (×1, first 5 affirmations stacked) |
| **Part III — Practice** | `06-section-divider` (PART III) |
| Chapter 8 — Numerological Fortune | `01-chapter-opener` → `04-data-numerology` (Life Path card) → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 9 — Planetary Influences | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 10 — Daily Mantras | `01-chapter-opener` → `05-affirmations` (Morning) → `05-affirmations` (Midday) → `05-affirmations` (Evening) |
| Chapter 11 — Sacred Morning Ritual | `01-chapter-opener` → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
| Chapter 12 — Year Ahead | `01-chapter-opener` → `02-standard-body` (×N) → `04-data-numerology` (Personal Year card) → `03-standard-body-with-quotes` |
| **Chapter 13 (BONUS) — Your Birthstone** | `01-chapter-opener` → **`08-birthstone`** (talisman feature page — stone chosen at render time from `order.birthday`'s month) → `02-standard-body` (×N) → `03-standard-body-with-quotes` |
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

1. Split on `# Chapter N:` headings (a **single** `#`) to get 12 chapter
   blocks (plus the pre-chapter "Welcome" block and the post-Chapter-12
   "Closing" block). The parser's `HEADING_RE` only matches single-`#`
   lines — `##` is reserved for subsection headings WITHIN a chapter.
2. For each chapter, the heading text after `Chapter N: ` is `CHAPTER_TITLE`.
   If it contains an em-dash (`—`), split on it: left side becomes the title,
   right side becomes `CHAPTER_SUBTITLE`. Otherwise leave subtitle blank.
3. The first paragraph after the `#` heading is `LEAD_PARAGRAPH`.
4. Each `## ` inside the chapter is a `SUBSECTION_HEADING`; the prose
   following it accumulates into `BODY_PARAGRAPH`.
5. For Chapters 5/6/7, the `## Your 10 [Pillar] Affirmations` section is
   parsed as a numbered list (lines beginning `1.`–`10.`). The **first 5**
   affirmations are passed to the chapter's closing `05-affirmations.pdf`
   page where they render stacked vertically (`drawAffirmationList`
   auto-shrinks the font in 0.5pt steps from the style's max down to 9pt
   so all 5 fit between the gold subtitle band and the name/placement row).
6. For Chapter 10, the `## Morning`, `## Midday`, `## Evening` subheadings
   each contribute three mantras to one `05-affirmations.pdf` page. The
   recipe walker tracks an `affirmationIndex` counter so the three
   consecutive `affirmations` steps in Chapter 10's recipe map to
   Morning → Midday → Evening in order. Each page renders **all** mantras
   for that time-of-day stacked (up to 5; today the prompt emits 3 per
   slot) using the same `drawAffirmationList` helper as the pillar pages.
7. Subsection paragraphs that begin with `> ` are **filtered out** before
   numbered-list / mantra extraction. The chapter's pull quote often
   trails the last subsection without a `##` break, so without this filter
   `extractNumberedList`'s greedy lazy capture would absorb the
   blockquote text into the final list item (this surfaced in Chapter 10
   Evening before the fix — the closing pull quote leaked into the third
   mantra). `extractPullQuote` still finds blockquotes from the raw body
   string, so quote rendering is unaffected.
8. `PULL_QUOTE`: pick the **last** markdown blockquote (`> ...`) in the
   chapter. The system prompt instructs the model to place the chapter's
   featured pull quote as a single `> ` line at the very end of each chapter
   (see `book-prompt.md` → "Pull-Quote Requirement"), so taking the last
   blockquote ignores any incidental ones the model uses mid-body for
   emphasis. Multi-line `> ` blocks are joined into one quote. If the
   chapter has no blockquote at all, fall back to the last sentence of
   `LEAD_PARAGRAPH`.
9. **Chapter 13 (BONUS) — birthstone resolution.** The stone name, tagline,
   and visual are NOT parsed from the AI's markdown — they're resolved at
   render time from `order.birthday`'s month inside the renderer's
   `BIRTHSTONES` table (`render.ts`). The AI prompt builder in
   `astrology.ts` calls `birthstoneForBirthday(order.birthday)` and
   substitutes the resolved stone name + meaning into the Chapter 13
   prompt block so the model writes about the correct stone. The renderer
   and the prompt assembler are deliberately driven by the same lookup
   semantics so the page visual and the prose stay consistent — when
   updating one table (e.g. swapping June from Pearl to Alexandrite),
   update the matching entry in the other.

## Birthstone images (Chapter 13)

Drop curated PNGs into [`birthstones/`](birthstones/) keyed by the stone
slug to upgrade the Chapter 13 feature page from the vector gem fallback
to real gem photography. The renderer looks for these filenames; any
missing file falls back to a coloured-circle vector visual so the page
always renders cleanly.

| Birth Month | Stone | Lookup file | Tagline |
|---|---|---|---|
| January | Garnet | `birthstones/garnet.png` | Symbolizes trust, strength, and protection. |
| February | Amethyst | `birthstones/amethyst.png` | Carries royal calm, intuition, and quiet wisdom. |
| March | Aquamarine | `birthstones/aquamarine.png` | Channels tranquility, hope, and clarity of mind. |
| April | Diamond | `birthstones/diamond.png` | Represents eternity, strength, and resilience. |
| May | Emerald | `birthstones/emerald.png` | A symbol of rebirth, devoted love, and growth. |
| June | Pearl | `birthstones/pearl.png` | Symbolizes purity, balance, and quiet wisdom. |
| July | Ruby | `birthstones/ruby.png` | Known for passion, courage, and vital aliveness. |
| August | Peridot | `birthstones/peridot.png` | Linked to prosperity, joy, and inner strength. |
| September | Sapphire | `birthstones/sapphire.png` | Embodies truth, loyalty, and sovereign wisdom. |
| October | Opal | `birthstones/opal.png` | Represents creativity, hope, and emotional healing. |
| November | Citrine | `birthstones/citrine.png` | Radiates joy, abundance, and warm positivity. |
| December | Turquoise | `birthstones/turquoise.png` | Represents good fortune and spiritual alignment. |

**Image specs:** square crop (1:1), transparent or solid background, ≥600 ×
600 px (the widget rect is 158 × 159 pt — roughly 658 × 663 px at 300 DPI).
The renderer centres the image inside the decorative circular frame and
preserves aspect ratio. The vector fallback inherits the stone's `color`,
`colorHi`, and `colorLo` triples from the `BIRTHSTONES` table in
[`render.ts`](../api-server/src/routes/zodiac-orders/templatedPdf/render.ts) —
edit those triples if you want to retune the fallback look without
shipping PNGs.

The stone lookup table is duplicated between the renderer (`BIRTHSTONES`
in `render.ts`) and the prompt builder (`BIRTHSTONE_BY_MONTH` in
`astrology.ts`); keep the two in sync.

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
   page of a chapter. **Quote-only template** — there are no body-paragraph
   slots on this page. The renderer fills the header band, the subsection
   heading, and the pull quote (auto-shrunk to fit the field), then ends
   the chapter. All chapter prose is expected to be exhausted on the
   preceding `02-standard-body` + `07-body-continued` pages before this
   page is emitted.

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
- **Big glyphs centred in rect (`NUMBER`, `SIGN_GLYPH` on `04-data-numerology`).**
  Those widget rects are sized for 8–10pt placeholder text but the renderer
  draws at 40–64pt. Anchoring the big glyph at slot.y (the placeholder
  baseline) would overflow the rect upward into the adjacent card heading.
  `drawBigCenteredInRect` recovers the rect bounds from the slot and
  vertically centers the glyph inside, so it fills the card's visible
  space without overlap. The helper also accepts a fallback string (e.g.
  the sign's first letter) for when the embedded font can't encode the
  glyph — important for `SIGN_GLYPH` (Unicode U+264C ♌ etc. aren't in
  WinAnsi, which the Times-Roman fallback uses). Drop Cormorant Garamond
  TTFs into [`fonts/`](fonts/) to get real zodiac glyphs instead of the
  letter fallback.
- **`ARCHETYPE_NAME` intentionally skipped on `04-data-numerology`.** The
  re-designed template places the `ARCHETYPE_NAME` widget at the same y
  (~352) as `INTERPRETATION_BODY_1` (~350). Drawing both produces visible
  overlap. The archetype information is already conveyed by the big
  `NUMBER` + `CALCULATION` pair, so the standalone archetype slot is
  left unfilled.
- **Dynamic pull-quote sizing on `03-standard-body-with-quotes`.** The
  template's 4 `BODY_PARAGRAPH` slots are really 2 zones (above/below the
  decorative quote band). The renderer (`buildPullQuotePage`):
  1. **Auto-shrinks the quote font** in 0.5pt steps (from 16pt down to 11pt
     min) until the wrapped quote is at most 6 lines.
  2. **Pull-quote page is quote-only — no body paragraphs.** The
     `03-standard-body-with-quotes` template was redesigned (May 2026)
     into a minimal layout: header band → small gold diamond ornament
     → large centered PULL_QUOTE field → bottom rule with page number.
     There are no `BODY_PARAGRAPH_*` slots on this template.

     `buildPullQuotePage` fills only **four** of the five widgets
     (`READER_FIRST_NAME`, `CHAPTER_TITLE`, `PULL_QUOTE`, `PAGE_NUMBER`)
     and **intentionally leaves `SUBSECTION_HEADING` unfilled** — rendering
     both an italic-gold heading AND an italic-gold pull quote reads as
     "two competing quotes" and visually fragments the page. The
     SUBSECTION_HEADING widget remains in the template for future
     flexibility but is skipped on every render. The quote is centred
     vertically inside its widget rect via `drawPullQuoteCentered`, which
     also: (a) wraps the quote in typographic curly double quotes (“ ”),
     (b) renders at the style's 20pt size for visual prominence (auto-
     shrinking only if the wrapped text exceeds 8 lines), and (c) draws a
     small celestial decoration below — three gold filled circles
     connected by short gold lines (•—•—•), drawn as pdf-lib vector
     primitives so it's font-independent.
     Returns `{ consumed: 0, total }` (any body paragraphs passed in are
     untouched — chapter prose is rendered on the preceding
     `02-standard-body` and `07-body-continued` pages, not here). No
     mask workarounds needed — the redesigned template has transparent
     widget fills and no baked-in decorative band.
  3. **Sizes body zones around the actual quote extent**, not the template's
     fixed band — so a long quote pushes body paragraphs out of the way
     instead of overlapping them.
  4. **Stacks paragraphs dynamically** inside each zone (same 14pt gap +
     leading as body-continued), only drawing whole paragraphs that fit.
  5. **Returns `{ consumed, total }`** so callers can spill the remaining
     paragraphs onto `07-body-continued` pages.

## Hardcover wrap (`00-hardcover-editable.pdf`)

A separate, standalone PDF — **not** part of the interior page-type system.
It's the case-wrap that prints around the outside of the hardback book.

**Print spec (Lulu US Trade hardcover):**

| | Value |
|---|---|
| Total document size (with wrap) | 14.00 × 10.75 in (1008 × 774 pt) |
| Hardcover board size per side | 6.25 × 9.50 in |
| Wrap area / bleed (all four edges) | 0.625 in |
| Spine width | varies by page count; 0.25 in minimum |
| Hinge area (from spine edge) | 0.4375 in |

**Renderer:** [`buildHardcoverWrap(order)`](../api-server/src/routes/zodiac-orders/templatedPdf/render.ts)
returns a `Buffer` directly. Smoke-test with
`pnpm --filter @workspace/api-server run smoke-template -- hardcover`.

**Placeholders (AcroForm widgets):**

| Placeholder | Location | Note |
|---|---|---|
| `BOOK_TITLE` | Back cover, below intro paragraph | Series title — currently hard-coded to `"HOLISTIC GROWTH"` |
| `READER_FIRST_NAME` (×2) | Back cover body line + Spine | Same field appears twice; **the spine instance is rendered rotated 90° in uppercase** |
| `BIRTH_PLACE` (×2) | Back cover body line + Front cover "IN:" line | Same value, two positions |
| `DATE_OF_BIRTH` (×2) | Back cover body line + Front cover "BORN:" line | Formatted "Month DD, YYYY" |
| `FULL_NAME` | Front cover, below "LIFE PATH" subtitle | Customer's full name in uppercase |

The renderer **dispatches by widget rectangle** rather than by field-array
index — for the two `READER_FIRST_NAME` widgets, it detects the spine (narrow
< 30pt wide, tall > 60pt) and rotates that instance 90°. The back-cover
instance renders normally.

## Smoke testing per template

Render a single template page with mock content to iterate visually
without regenerating the full 49-page book:

```bash
pnpm --filter @workspace/api-server run smoke-template -- <id>
```

Valid `<id>`s: `chapter-opener`, `standard-body`, `standard-body-with-quotes`,
`data-numerology`, `affirmations`, `section-divider`, `body-continued`,
`welcome-letter`, `closing-letter`, `zodiac-moon`, `zodiac-rising`,
`birthstone`, plus `body-stress` (5+ pages of standard-body + body-continued
with a long mock chapter — exercises the text-flow path) and `hardcover`
(the case-wrap PDF at 14"×10.75" — see "Hardcover wrap" below). The
moon/rising IDs render the mock-order's `moonSign` / `risingSign`
(Cancer / Libra) on the single dynamic template; `birthstone` renders the
stone matching the mock-order's birthday (May 15 → Emerald) — change the
mock-order's `birthday` in `render.ts` (or drop a different month into
`smokeTemplate(...)`) to preview the other 11 stones.

Output writes to `test-output/test-<id>.pdf`. **Quit Preview entirely (Cmd+Q)
before reopening** — Preview caches recently-viewed PDFs and can show a stale
render even after the file changes.

## Smoke testing the full book

Render the complete ~60-page interior with hand-crafted mock content that
exercises every template + recipe step — TOC, welcome letter, 3 section
dividers, 12 chapters, affirmation pages, mantra pages, two data-numerology
cards, all pull-quote pages, and the closing letter:

```bash
pnpm --filter @workspace/api-server run smoke-full-book
```

Output writes to `test-output/test-full-book.pdf`. Use this to validate
end-to-end chapter-recipe flow before generating real AI content. The
companion DB-driven version (`smoke-pdf`) pulls the most-recent
`generatedContent` row from MySQL instead.

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
| Visual QA on each template | ✅ — all 11 page-type templates reviewed (chapter-opener, standard-body, standard-body-with-quotes, data-numerology, affirmations, section-divider, body-continued, welcome-letter, closing-letter, zodiac-moon, zodiac-rising, **birthstone**) |
| Chapter 13 BONUS — Birthstone | ✅ — `buildBirthstonePage` in [`render.ts`](../api-server/src/routes/zodiac-orders/templatedPdf/render.ts) + Chapter 13 prompt block in [`astrology.ts`](../api-server/src/routes/zodiac-orders/astrology.ts). Stone resolved from `order.birthday`'s month against the `BIRTHSTONES` lookup table; PNG-from-disk first, vector gemstone fallback otherwise. Drop curated PNGs into [`birthstones/`](birthstones/) to upgrade the visual. |
| Hardcover wrap (`00-hardcover-editable.pdf`) renderer | ✅ — `buildHardcoverWrap(order)` in [`render.ts`](../api-server/src/routes/zodiac-orders/templatedPdf/render.ts). Smoke-test with `pnpm --filter @workspace/api-server run smoke-template -- hardcover`. **Wired into production:** `generateCoverPDF(order, pageCount)` in [pdfGenerator.ts](../api-server/src/routes/zodiac-orders/pdfGenerator.ts) now delegates to `buildHardcoverWrap`. The pdfkit-from-scratch path is preserved as `generateCoverPDFLegacy` for diagnostic comparison (same delegation pattern as `generateInteriorPDF` → `generateTemplatedInteriorPDF`). |

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
- ~~**`closing-letter.pdf` has a typo:** the `{{PERSONAL_YEAR` token is missing
  its closing `}}` and won't be detected by the extractor until fixed in the
  design tool. The renderer skips this slot for now.~~ *Fixed in the May 2026
  re-export — `PERSONAL_YEAR` now extracts cleanly.*
- **Last page of a chapter often has a large bottom gap** when the prose
  ends well above slot[3]. Two fixes worth considering — (a) prompt the AI
  to target ~2200–2400 characters per chapter so paragraphs reliably fill
  4 body-continued slots, or (b) add a decorative glyph (planet,
  constellation, moon phase) at y≈80–120 of `07-body-continued-editable.pdf`
  so the tail space gets a visual closer.
- ~~**Cover & back cover** are generated separately
  (`generateCoverPDF` in [pdfGenerator.ts](../api-server/src/routes/zodiac-orders/pdfGenerator.ts)).
  The `00-hardcover-editable.pdf` is uploaded but not yet wired into the
  cover pipeline; templating the cover would let the customer's name &
  birth chart sit on the wrap.~~ *Resolved in the May 2026 pass:
  `generateCoverPDF` now delegates to `buildHardcoverWrap`, which fills the
  customer's `READER_FIRST_NAME` (twice — back cover + rotated spine),
  `FULL_NAME`, `DATE_OF_BIRTH` (twice), `BIRTH_PLACE` (twice), and
  `BOOK_TITLE` widgets on the designer artwork.*
- **Fixed-spine constraint.** The hardcover wrap PDF is delivered at a
  fixed total size (14 × 10.75 in = 1008 × 774 pt) with the spine width
  baked into the template artwork by the designer. The `pageCount`
  parameter on `generateCoverPDF` is currently unused — the Lulu pod
  package `0600X0900FCSTDHC060CW444GXX` has a hardcover spine determined
  by board thickness, not the linear paperback formula
  (`pageCount / 444`). If a future book trim/page-count diverges from
  what the template was designed for, the spine will visually
  misalign with the book block; re-export the template with the matching
  spine width and replace `00-hardcover-editable.pdf` to fix.
- ~~**Moon-sign and Rising-sign** don't have analogous archetype templates —
  only the Sun sign gets the visual treatment (the zodiac templates say
  "YOUR SUN SIGN IS"). If you want the same visual reverence for Moon and
  Rising, the designer would need to produce parallel sets, or relabel the
  existing 12 to be sign-agnostic.~~ *Resolved in the May 2026 design pass:
  `zodiac-moon-editable.pdf` and `zodiac-rising-editable.pdf` each ship as a
  single dynamic template (one PDF for all 12 signs, not 12 PDFs per
  chapter). The renderer fills the sign name into `ZODIAC_NAME_{MOON|RISING}`
  and the decorative glyph (or letter fallback) into
  `ZODIAC_GLYPH_{MOON|RISING}`. The Sun-sign chapter still uses the 12-PDF
  archetype set since each Sun sign carries dedicated archetype artwork.*
- **Zodiac glyph fallback to letter without Cormorant Garamond.** The
  `ZODIAC_GLYPH_{MOON|RISING}` decorative band currently renders the sign's
  first letter (e.g. "C" for Cancer, "L" for Libra) because pdf-lib's
  Times-Roman fallback is WinAnsi-only and lacks the unicode zodiac
  codepoints (U+2648–U+2653). Drop the OFL `CormorantGaramond-*.ttf` files
  into [fonts/](fonts/) to get the real ♋ ♎ glyphs automatically — the same
  font set also restores `SIGN_GLYPH` on the data-numerology card.
- ~~**The AI prompt** uses `# Chapter N:` for chapter headings while the
  formatting instructions earlier in the same prompt say to use `##` for
  main chapters.~~ *Resolved with the May 2026 `book-prompt.md` extraction:
  the prompt now consistently uses `#` for chapter headings and `##` for
  subsections. The parser's `HEADING_RE` was tightened to match only
  single-`#` lines so subsection markers no longer get treated as chapter
  breaks.*
