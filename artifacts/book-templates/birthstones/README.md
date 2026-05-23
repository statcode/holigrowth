# Birthstone Images — Chapter 13 (BONUS)

Drop curated PNGs here to upgrade the Chapter 13 "Your Birthstone" feature
page from the vector gem fallback to real gem photography.

Expected filenames (slugs match the `BIRTHSTONES` lookup in
[`render.ts`](../../api-server/src/routes/zodiac-orders/templatedPdf/render.ts)):

| Month | Stone | Filename |
|---|---|---|
| January | Garnet | `garnet.png` |
| February | Amethyst | `amethyst.png` |
| March | Aquamarine | `aquamarine.png` |
| April | Diamond | `diamond.png` |
| May | Emerald | `emerald.png` |
| June | Pearl | `pearl.png` |
| July | Ruby | `ruby.png` |
| August | Peridot | `peridot.png` |
| September | Sapphire | `sapphire.png` |
| October | Opal | `opal.png` |
| November | Citrine | `citrine.png` |
| December | Turquoise | `turquoise.png` |

**Specs:** square (1:1), transparent or solid background, ≥600 × 600 px
(the AcroForm widget rect is 158 × 159 pt — roughly 658 × 663 px at 300 DPI).
The renderer centres the image inside the decorative circular frame on
[`08-birthstone-editable.pdf`](../08-birthstone-editable.pdf) at its
natural aspect ratio.

If a file is missing, the renderer draws a coloured-circle vector
gemstone in the stone's natural colour (with a darker inner ring and a
pearly highlight) — every birthday renders cleanly even before any
images land here.
