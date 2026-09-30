---
kind: package-bundle
description: Optimize explicit instructions with DSPy and optionally replace a selected persona fragment in the current Harness session.
---

# dsh-dspy

## Summary

Optimize instructions with DSPy 3.4.0 (GEPA, MIPROv2, or BootstrapFewShot), inspect results, and generate deterministic RLM scaffolds. Tools, `/dspy`, and a DSPy conversation tab expose the controls. Application requires an explicit `personaPrefix` or `personaSuffix` target and affects only the current live agent. The plugin supports the local Harness **0.2.0-rc.2 / Cordis 4.0.4**; it does not modify the Harness loop.

## Contents

- [Development and activation](#development-and-activation)
- [Configuration](#configuration)
- [Controls and examples](#controls-and-examples)
- [Model experience](#model-experience)
- [Limitations](#limitations)
- [Implementation and validation](#implementation-and-validation)
- [Migration](docs/upgrade-guide/v0.1.0/current-harness/guide.md)

## Development and activation

Place the repositories at `ai/deepseek-harness` and `ai/dsh-plugins/dsh-dspy`. This checkout links its development dependencies to `../../deepseek-harness`; build Harness first, then build and pack this bundle:

```sh
pnpm install --ignore-scripts
pnpm typecheck
pnpm test
pnpm build
pnpm pack
pnpm setup:python
```

`setup:python` explicitly creates this checkout's `python/.venv` and installs pinned DSPy 3.4.0. Missing interpreters, venv failures, or pip errors fail the command. Python setup is not an installation lifecycle hook. `python: auto` selects the venv inside the loaded package when present, otherwise `python3` on POSIX or `python` on Windows; DSPy mode fails if the selected interpreter lacks DSPy. Explicit heuristic mode needs only Python's standard library.

Tarballs include Python source and the setup script, not a virtual environment. A checkout's prepared venv is not copied into an installed tarball. Before using DSPy in an installed package, either run `node <installed-package>/scripts/ensure-venv.mjs` explicitly or configure `python` with an absolute path to an existing interpreter containing DSPy 3.4.0 and the declared dependencies. An existing checkout venv can supply that interpreter while the installed package supplies the Python source. Tarball installation runs no Python setup, prepare, postinstall, or build hook; `prepack` builds release artifacts only when creating the archive.

The generated `dsh-dspy-0.1.0.tgz` is a bundle whose `cordis.patch.yml` inserts the host plugin. Install it through the target Desktop instance's **Plugins** page, enable it, and restart Desktop when requested; do not replace Desktop's reserved profile with an npm-CLI-managed profile. Open a conversation and select **DSPy**. The panel loads configuration and history without optimization or prompt changes. The browser entry awaits its strict remote descriptor mount and injects `remote.dspyApi` before registering the tab; startup failure is reported instead of leaving a missing panel.

The running Harness supplies Cordis and the declared 0.2.0-rc.2 packages. Their optional peer metadata prevents standalone package installation from adding separate runtime copies; it does not make the plugin's injected Host or Client services optional. A Host-only deployment needs no Client services unless it loads the browser entry.

Credentials belong to Harness. Configure the reference named by `apiKeyRef` through Harness credentials/settings. The plugin calls `ctx.credentials.resolve(credentialRef(apiKeyRef))` once per DSPy operation. It passes only the resolved key to its owned child, never to the panel, status, history, tool results, or logs. Unrelated ambient secrets are not inherited. Heuristic and scaffold operations receive no API key.

## Configuration

An omitted Host configuration, including the bundle's insertion row, resolves all documented defaults before mounting. All supplied fields are validated at load; null, unknown fields, and obsolete settings reject the configuration. The panel's mode, strategy, metric, and auto-apply settings affect subsequent operations in this loaded plugin; they are not saved into the profile.

| Field | Default | Meaning |
| --- | --- | --- |
| `strategy` | `gepa` | `gepa`, `miprov2`, or `bootstrapFewShot`; no optimizer substitution |
| `mode` | `dspy` | Real optimization; select `heuristic` explicitly for an unmeasured deterministic rewrite |
| `metric` | `exact_match` | `exact_match` or `contains`, comparing the predicted answer with `expected` |
| `autoApply` | `false` | Apply only when the call also names a target fragment and current agent |
| `maxRounds` | `3` | 1–20; bootstrap rounds, MIPRO trials, or GEPA full-evaluation budget |
| `maxDemos` | `4` | 0–16; compiled demonstration limit |
| `python` | `auto` | Interpreter command or path |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | Harness credential reference, not a literal secret |
| `baseUrl` | `https://api.deepseek.com` | DSPy model endpoint |
| `model` | `openai/deepseek-chat` | DSPy/LiteLLM model identifier |
| `requestTimeoutMs` | `300000` | Positive bridge-request deadline |
| `shutdownTimeoutMs` | `2000` | Grace period before forced child termination |
| `historyLimit` | `100` | Positive maximum retained result count |
| `dataDir` | empty | Optional history root; empty keeps history in memory |

History lives at `<dataDir>/dspy/history.json` when configured. Invalid history and save failures reject; save failure restores the previous scoped instruction. Saved history does not restore prompt replacements on reload. Client-selected application targets are deliberately not a deployment-wide default.

## Controls and examples

`dspy_status` returns configuration, latest training example count, latest result, and history. `dspy_evolve` accepts an explicit instruction or reads the explicitly selected existing fragment from the current agent. Real DSPy requires explicit labeled examples with non-empty input maps, string input values, and a reference `expected` answer:

```json
{
  "instruction": "Answer factual questions using the supplied context.",
  "strategy": "bootstrapFewShot",
  "trainset": [
    {"input": {"question": "What is 1+1?"}, "expected": "2"}
  ],
  "dryRun": true
}
```

Every example must have the same input field names. Names must use ASCII Python identifier syntax other than `answer` or `expected`. No session mining or feedback-to-answer conversion occurs.

An explicit keyless rewrite can be requested with:

```json
{
  "instruction": "Answer using the provided context.",
  "mode": "heuristic",
  "dryRun": true
}
```

To apply, select `targetSection: "personaPrefix"` or `"personaSuffix"` and `autoApply: true` in the current session. `dryRun: true` always prevents application. A missing target/current agent fails before optimization. A complete-system-prompt agent without that fragment cannot use fragment application.

The panel exposes instruction and training-example fields, explicit target selection, mode/strategy/metric controls, dry run, apply, and history. Failures retain form values and existing history. The `autoApply` setting controls calls that omit an application choice; the panel's two action buttons always choose explicitly.

`/dspy status` and `/dspy config` inspect state. The command uses request JSON rather than ambiguous flag parsing:

```text
/dspy evolve {"instruction":"Answer clearly.","options":{"mode":"heuristic","dryRun":true},"trainset":[]}
```

`dspy_rlm` returns `{plan, code, rationale, executed: false}`. It names only supplied tool names and executes neither its scaffold nor model calls.

## Model experience

The three tools use the current Harness per-property parameter declarations and canonical JSON outputs. Harness renders and durably logs their tool results. Heuristic results carry `mode: "heuristic"` and **null metrics**, never a fabricated improvement. Real scores measure the compiled DSPy program on the provided training set; failed predictions reject the run instead of becoming zero scores.

An applied instruction replaces only the selected existing persona fragment during that agent's subsequent system-prompt assembly. The normal Harness loop commits the exact assembled prompt as `system/message`; the plugin supplies no unlogged model input. Other sections and agents retain their prompts. Already logged model requests retain their assembled prompts.

## Limitations

- There is no supported old `deployment:persona` complete-prompt slot. Choose an explicit prefix or suffix target; this plugin never invents an unrelated section or replaces the whole system prompt.
- Prompt application lasts only while the plugin and live agent remain loaded. It does not edit presets, global deployment configuration, or resume settings.
- Application copies the optimized **instruction only**. Compiled demonstrations remain in the result and are not inserted into Harness history or prompt fragments. DSPy program scores are not measured live-Harness improvements.
- Feedback alone is not a reference answer. Automatic session/feedback mining and the old `feedback` metric are not available.
- RLM is a deterministic scaffold generator, not an autonomous executor.
- Real network/provider optimization and Desktop visual behavior require operator verification with the configured provider and installed Desktop instance. Keyless tests cannot establish provider quality or network availability.

## Implementation and validation

The host uses real `tools`, `commands`, `agents`, `credentials`, `systemPrompt`, and Typert registry APIs. Host and client share explicit strict invocation descriptors; the client uses actual `RemoteResult` values. The browser consumes the Conversation-owned `conversation.view` slot, typed English/Chinese dictionaries, existing theme tokens and primitives, and shell-owned outcome toasts.

Client startup awaits the Gateway descriptor mount and injects the generated `remote.dspyApi` service into the controls' Context. Mount failures reject startup instead of leaving an active plugin without controls. Namespace withdrawal or plugin unload removes the tab; unloading during namespace creation prevents subsequent tab registration.

Each operation owns a Python child. Cancellation, timeout, invalid protocol, startup failure, premature exit, and disposal settle pending requests and await child exit; teardown escalates if necessary. Provider stderr and exception text cannot disclose credentials into product output.

```sh
pnpm typecheck
pnpm test
pnpm build
node scripts/smoke-built.mjs
cd python
DSPY_CACHEDIR="$PWD/.cache" .venv/bin/python -m unittest discover -s tests -v
```

`pnpm test` builds the browser artifact before executing the Client factory fixture. Tests cover real Cordis/Gateway/Connection/SlotRegistry Client activation and teardown, namespace-mount failure, disposal during namespace construction, current Harness prompt scoping, exact request reconstruction from durable session events, an owner-local prompt snapshot, strict remote result handling, canonical tool dispatch, credential-reference resolution, persistence failures, and bridge quiescence. Python tests use actual DSPy 3.4 classes with a keyless DummyLM; GEPA/MIPRO signature tests replace optimizer compilation, while BootstrapFewShot executes its optimizer.

GitHub CI checks out the plugin under `dsh-plugins/dsh-dspy` beside a Harness checkout pinned by `HARNESS_REF` in `.github/workflows/ci.yml`. It builds Harness before checking the plugin and uses the explicit Python setup command. Update that pin together with a Harness compatibility change.
