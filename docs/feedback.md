# Game Feedback

Record confirmed Engine, SDK, template, build, asset, runtime, or browser issues
encountered while developing this game. This file and the root `README.md` are
shipped unchanged in the Web ZIP. Keep credentials and private URLs out of it.

```markdown
### YYYY-MM-DD — Short issue title

- Scope: Engine | SDK | template | build | asset | runtime | browser
- Reproduction: exact command or smallest user-visible sequence
- Expected: what should happen
- Actual: what happened
- Evidence: log, screenshot, URL, or commit path
- Status: open | workaround | fixed | blocked
```

### 2026-11-06 — `asset import` reports `reused: true` for a `.ui.html` whose Catalog row never exists

- Scope: asset
- Reproduction: author `assets/hud/hud.ui.html` + `.css` + `.html.meta.json` (subAssets GUID declared),
  then `pnpm exec forgeax asset import --path assets/hud/hud.ui.html`, then `pnpm exec forgeax dev start`.
- Expected: the imported `ui` asset enters the runtime Catalog and the pack referencing it validates.
- Actual: `asset import` prints `reused: true` (so the importer believes the row is present), but the DDC has
  no row for the declared GUID. `dev start` then fails with
  `asset-package-invalid … detail.reason: publication generation` on that GUID.
  The failure is not self-correcting: re-import, DDC clear, and renaming the sourceKey all reproduce it.
- Evidence: `dev start` stderr; the declared GUID was `019fb7ce-5200-7000-8000-000000000001`.
- Status: workaround — abandoned the UI importer path for this HUD and built it with direct DOM in the
  frontend realm. The orphan `.ui.*` files and their GUID constant were deleted so nobody re-imports them.

### 2026-11-06 — `play.mouse.move()` silently does not dispatch `pointermove`

- Scope: SDK
- Reproduction: in a `project play` script, call `await play.mouse.move({ x, y })` then read a state that
  depends on the pointer, e.g. the aim point behind `viewportToWorld`.
- Expected: a `pointermove` reaches the page, the same as a real mouse.
- Actual: zero `pointermove` events reach `window` (verified with a capture-phase listener:
  `{ moves: 0 }`). No error, no warning — the call resolves successfully and the game state never changes,
  so the failure looks like broken aim math.
- Evidence: the probe run reported `pointerMoves: { moves: 0 }` while
  `play.page.mouse.move(x, y)` — the native Playwright API — dispatched normally and produced
  `aimErrorMeters: 0.2` in the same script.
- Status: workaround — `scripts/playthrough.mjs` uses `play.page.mouse.move(x, y)` / `.down()` / `.up()`.

