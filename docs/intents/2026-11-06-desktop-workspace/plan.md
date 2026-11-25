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

- [x] Reassess the hero, day summary, upcoming day, focus note, and lesson timeline.
- [x] Give date navigation the full desktop work-area width; arrange the day hero
  and action/agenda column as a content-sized split view.
- [x] Remove desktop stretching from the add-event action and note focus row;
  keep next-study-day context available on free days.
- [x] Verify a free day, upcoming study-day context, and long subject names in
  the Today preview.
- [x] Review Today screenshots and layout at 1280x720, 1920x1080, 2560x1440,
  and 3440x1440.
- [ ] Add focused visual cases for past dates and days with multiple personal
  events; physical monitor/graphics-hardware verification remains external.

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
- Responsive pass complete for 320-3440 px: added tablet-first full-screen
  layout from 561-959 px, expanded the layout QA matrix to phone, landscape,
  tablet, laptop, desktop, and ultrawide sizes, and fixed vertical clipping in
  the wide Today week preview. A tall-monitor pass now allocates remaining
  height to the week overview; screenshots at 2560x1440 and 3440x1440 confirm
  that the page no longer ends with a large empty band.
- Low-performance profile added: device memory, core count, Data Saver, and a
  short frame-pacing sample select a lite visual mode before sustained effects
  can burden constrained hardware. The lite mode stops ambient motion and
  backdrop filters while preserving functional transitions. Simulated software
  rendering, 2 cores, 2 GB, and 4x CPU slowdown passed across all four tabs; QA
  also scans computed animations on elements and pseudo-elements to ensure no
  decorative infinite loops remain.
- Today desktop layout now puts the date navigator across the work area, keeps
  the day hero and agenda/action column aligned, and sizes event/note actions to
  their content instead of filling empty vertical space. Free-day next-study
  context is visible on desktop. New geometry assertions cover date/preview
  alignment, hero/agenda alignment, action height, and content order; screenshots
  were inspected at standard desktop and ultrawide sizes.
- Notes navigation commits and starts the shared tab transition before the lazy
  module resolves. On a 402x874 viewport, a deliberately blocked Notes chunk
  still produced a tab commit in 8 ms; this is separate from Playwright's full
  pointer gesture duration. Loading uses a borderless centered status instead of
  placeholder tiles or a blank outlined card. The low-end profile passed all four
  tabs with software rendering,
  4x CPU throttling, 2 cores, and 2 GB simulated memory.
- Verification: TypeScript, 583 tests, production build, service-worker syntax,
  and low-end browser checks pass. Focused layout QA passes at 402x874, 1280x720,
  1920x1080, 2560x1440, and 3440x1440; a screenshot was inspected at both
  ultrawide sizes. Responsive surface coverage across phone, landscape, tablet,
  laptop, desktop, and ultrawide sizes passed in focused sessions after one
  Edge process crash during a long all-size run. Physical weak-PC and iPhone
  testing remain unverified. Past-date and multiple-personal-event visual cases
  are still open.
