# Moya UI subset

Source: `moya-reader`, revision `d00dc7a2b2d94cc042951697ad447d7028a491fe`, Apache-2.0 (`LICENSE`).

This directory contains source components and pure reader/navigation helpers copied from Moya so this project builds without the sibling repository. `client/moya-ui.jsx` binds them to this project's source APIs. Source files retain their original paths. Some type-only imports refer to original contracts; the client build uses esbuild and erases them, and does not claim a full TypeScript check of the original application.

Intended differences from the original files:

- `SourceReleasePanel.tsx`: optional `selectionEnabled`, default `true`. Lite sets `false` to omit server download selection controls.
- `ReaderSettingsLayout.tsx`: imports the identical profile limits directly from `reading-profile.ts`, avoiding the unrelated application/TTS defaults graph.
- `CompatibilityPreferencesPanel.tsx`: optional `storageNotice`, preserving the original default. Lite supplies an accurate browser-storage notice; this adapter does not encrypt preferences.
- `SourceQuickJump.tsx`: removes search-input autofocus. The original dialog still traps focus and initially focuses its close button; opening it no longer raises the mobile keyboard.
- `SourceReleaseMenu.tsx`: the batch-read action is labeled “여기까지 읽음” and the adapter includes the selected chapter. Scroll repositions the popup instead of immediately closing it; `use-menu-popover.ts` focuses without scrolling. Download controls remain unavailable without a local imported book. Read/unread and title edits use browser metadata.

Other imported components/algorithms retain original behavior. Product CSS is copied in `public/moya.css` with source section comments; lite bindings are in `public/styles.css`. The logo is the original Moya branding asset.

Build output includes this license and third-party licenses in `public/runtime/THIRD_PARTY_LICENSES.txt`. This subset is not the complete original app or complete reader. See `docs/MOYA_UI.md` for the acceptance checklist and remaining work.

## Source reader viewport integration (2026-09-27)

The original `ReaderViewport` and `PaginatedReaderViewport` now use a source chapter
repository with stable content hashes, source/work scoped metadata, original page
measurement/window cache, selection toolbar and decoration store. `text-core` only
contains the hash/sentence dependency graph. TanStack Virtual and noble hashes are
browser build dependencies, not server runtime services.

- `reader-defaults.ts` isolates `PARAGRAPHS_PER_PAGE` from application/TTS defaults.
- `reader-database.ts` supplies a separate `moya-source-reader-layouts` IndexedDB for
  disposable pagination maps; it does not import or migrate a server library.
- Viewports respect the configured center tap instead of forcing toggle chrome.
- `ReaderGestureSettings` optionally omits text TTS actions for comics.
- `BrowserNavigation` closes one or several modal layers by returning to the matching
  earlier screen entry; if no such entry exists, it replaces the current layer entry.
- FontFace loading, crop detection, focal anchor and continuous page location helpers
  retain their original algorithms. Source image/thumbnail loading is adapted to the
  connector scheduler. Native touch selection is opt-in in the lite controller.

- `ReaderDeviceControls` reports rejected wake/orientation locks inline and releases
  device locks when the source reader unmounts.

- `use-scroll-chapter-boundary.ts`: optional `eventRootRef` lets the comic adapter measure window scrolling while listening for touches only inside comic content. The original idle, wheel, touch and pull-feedback rules are shared with novels.
