---
kind: upgrade-guide
description: DSPy configuration, command arguments, stored results, and persona application require explicit current-Harness settings.
---

# Upgrade dsh-dspy for the current Harness

## Change

The plugin targets Harness 0.2.0-rc.2 and Cordis 4.0.4. Implicit keyless fallback, fabricated metrics, whole-persona replacement, automatic session mining, the `feedback` metric, and the unused `requireApproval` setting are not supported. Strict configuration rejects obsolete fields. `/dspy evolve` takes JSON request arguments. Remote methods return actual Harness `RemoteResult` values instead of invented wrappers.

## Migration

1. Build this checkout against its real local Harness development dependencies with `pnpm install --ignore-scripts` and `pnpm build`; use `pnpm setup:python` to install DSPy explicitly. Activate the bundle through the intended Desktop instance's Plugins page.
2. Remove `requireApproval` from plugin configuration. Replace `metric: feedback` with `exact_match` or `contains`, and supply labeled examples explicitly. For keyless rewriting, choose `mode: heuristic`; its metrics are null and unmeasured.
3. Supply an instruction or choose an existing fragment to read. Before application, explicitly select `targetSection: personaPrefix` or `personaSuffix` in the current session. Whole-prompt application is not a substitute. `dryRun: true` prevents application. Compiled demos are returned but not applied.
4. If configured history contains legacy synthetic results, preserve that file separately and use a fresh `dataDir`; legacy results are not accepted as current measured records. Saved history does not restore application on resume.
5. Replace old command flags with `/dspy evolve {"instruction":"Answer clearly.","options":{"mode":"heuristic","dryRun":true},"trainset":[]}`. Custom remote consumers must mount the plugin descriptors and unwrap `RemoteResult`.
6. Verify the DSPy tab appears, dry-run returns `applied: false`, heuristic metrics are null, and selected-fragment application changes only the selected live agent's next logged `system/message`. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `node scripts/smoke-built.mjs` for local integration evidence.
