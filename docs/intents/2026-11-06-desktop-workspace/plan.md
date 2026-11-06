# Plan: Desktop workspace

Status: in progress. Scope comes from the user's active goal on 2026-11-06.

## 1. Establish current evidence

- Read repository instructions, product roadmap, and continuous-improvement loop.
- Inspect current production build screenshots and desktop layout assertions.
- Preserve the current dirty worktree; do not publish without new authorization.

## 2. Week overview density

- Adapt `src/styles.css` so ultrawide desktop can scan all six days in one row.
- Update `scripts/qa-desktop-layout.cjs` to assert responsive track counts and
  one-row geometry at 2560x1440.
- Build and run browser QA; inspect the resulting screenshot for wrapping and
  legibility before keeping the breakpoint.

## 3. Today workspace hierarchy

- Reassess the hero, day summary, upcoming day, focus note, and lesson timeline.
- Prioritize actionable schedule data above decorative imagery.
- Verify short/long subject names, empty days, past days, and days with events.

## 4. Notes and settings workspace

- Keep folder navigation, note list, and note details balanced on laptop and
  ultrawide widths.
- Remove empty-state blank space only where a useful next action can fill it.
- Check editor, calendar, theme picker, and keyboard interactions.

## 5. Visual and interaction QA

- Run `pnpm run check`, `scripts/qa-desktop-layout.cjs`, and
  `scripts/qa-desktop-surfaces.cjs` against the production build.
- Review light and dark theme screenshots at laptop, standard desktop, and
  ultrawide sizes. Inspect console, focus order, reduced motion, and overflow.
- Record remaining limitations. Do not claim device verification from emulation.

## Current implementation checkpoint

- Section 1 complete.
- Section 2 complete: laptop keeps two/three columns, ultrawide shows all six
  days in one row; layout and surface QA pass. Evidence:
  `artifacts/qa/desktop-layout/week-grid-2560x1440.png`.
- Sections 3-5 remain open.
