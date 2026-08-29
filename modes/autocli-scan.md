# Mode: autocli-scan

Use this mode when the user wants Career-Ops to discover jobs through AutoCLI-backed Boss search instead of relying only on ATS APIs and generic web search. LinkedIn automation is unsupported; use the manual links from `npm run jobs:platform`.

## Goal

Preserve the normal Career-Ops pipeline while replacing or strengthening the discovery layer:

1. AutoCLI finds roles from the user's logged-in browser session
2. Career-Ops filters by title relevance and deduplicates
3. New offers go into `data/pipeline.md`
4. The normal evaluation, PDF, tracker, and interview-prep flow continues unchanged

## Files

- `portals.yml` → source configuration, title filters, tracked companies
- `scan.mjs` → hybrid scanner
- `data/pipeline.md` → pending offers
- `data/scan-history.tsv` → dedup history

## Configuration Rules

- Keep AutoCLI source definitions in `portals.yml` under `autocli_sources`
- Prefer `command` as a YAML array, not a shell string
- Require JSON output from AutoCLI
- Map Boss fields explicitly when output names differ from Career-Ops canonical fields

## Workflow

1. Read `portals.yml`
2. Verify `autocli_sources` exists and enabled entries are configured
3. Run `node scan.mjs --source <platform> --dry-run` if mappings need validation
4. Run `node scan.mjs` to write discovered offers into the pipeline
5. Continue with the standard Career-Ops evaluation flow

## Guardrails

- Never submit an application automatically
- Do not bypass `data/pipeline.md` or `data/scan-history.tsv`
- Keep personalization in `config/profile.yml`, `modes/_profile.md`, or `portals.yml`
