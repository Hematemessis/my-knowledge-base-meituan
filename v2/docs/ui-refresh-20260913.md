# UI refresh — 2026-09-13

## Direction

User references: https://dribbble.com/shots/7096120-Knowledge-Base-Admin and supplied Krisp workspace screenshots. Adapted the restrained sidebar, white content canvas, violet active states and document-list presentation; no third-party artwork or assets copied. Refero's surrounding catalog panel is not part of the product design.

## Changes

- Light gray/violet theme, compact task cards, clearer upload entry.
- Home now includes the real document library, filename search, file-type filter, selection count and a scoped-question action.
- Existing document selection is preserved when opening a scoped question from home.
- Original-document preview is a right-side modal drawer with a sticky filename/close header.
- Existing memory, candidate review, upload, document-version and chat APIs remain in place.
- Upload selection exceeding the remaining five-file allowance now reports that nothing was uploaded instead of silently ignoring extra files.
- Responsive adjustments at 1100, 820 and 640 px; reduced-motion support.

## Verification

- TypeScript passed; Vitest: 38 passed, 1 PostgreSQL integration test skipped.
- Production build passed using KNOWLEDGE_UI_PREVIEW=1 (isolated .next-ui output).
- Browser: real library of 11 files and 7 saved conversations loaded; filename search matched two versions; choosing one preserved a one-document scope in chat.
- Browser: PDF filter displayed the empty state for the all-Markdown fixture library; memory panel opened; saved-answer citation opened the matching source with a visible sticky close control.
- Visual checks: 1280 px desktop and 390 x 844 narrow viewport; narrow home had no horizontal document overflow. Viewport override reset after verification.
- No browser console errors observed during these checks.
- Upload API and fresh model generation were not re-exercised in this UI-only pass; existing backend tests and saved real-model answers were used. No user files deleted or modified.

## Preview

Final preview: http://127.0.0.1:3321/ . The original 3319 service remains separate; both access the existing isolated internship-test data directory. Preview is local, not a public deployment.

PowerShell, from v2, to rebuild and run this preview after stopping its existing process:

```powershell
$env:KNOWLEDGE_UI_PREVIEW='1'
pnpm build
$env:KNOWLEDGE_DATA_DIR=(Join-Path (Get-Location) '.data/internship-test-20260913')
$env:DATABASE_URL=''
pnpm exec next start -H 127.0.0.1 -p 3321
```

Use the normal build command without KNOWLEDGE_UI_PREVIEW to build the same UI into .next. The alternate output directory avoids replacing another running instance's build.
