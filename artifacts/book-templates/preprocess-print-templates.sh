#!/bin/bash
# Preprocess Claude.ai-exported PDF templates for Lulu-print compatibility.
#
# The editable-*.pdf files carry unembedded Helvetica / Times references in
# vestigial content-stream ops and widget appearance streams. Lulu's PDF
# normaliser rejects unembedded fonts. Ghostscript's pdfwrite device force-
# embeds all fonts, subsets them, and strips the vestigial refs — producing
# a print-safe -print.pdf variant we use for embedPdf while parse.ts keeps
# reading the -editable.pdf for AcroForm widget positions.
#
# Requires: ghostscript (brew install ghostscript on macOS).
#
# Run this whenever a template PDF changes. Output files are committed to
# git — production doesn't need ghostscript installed.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if ! command -v gs >/dev/null; then
    echo "ghostscript not found. brew install ghostscript" >&2
    exit 1
fi

for SRC in *-editable.pdf; do
    DEST="${SRC/-editable.pdf/-print.pdf}"
    echo "→ $SRC → $DEST"
    gs -q \
        -o "$DEST" \
        -sDEVICE=pdfwrite \
        -dEmbedAllFonts=true \
        -dSubsetFonts=true \
        -dCompatibilityLevel=1.7 \
        -dPDFSETTINGS=/prepress \
        "$SRC"
done

echo "done — $(ls -1 *-print.pdf | wc -l | tr -d ' ') print-safe templates emitted"
