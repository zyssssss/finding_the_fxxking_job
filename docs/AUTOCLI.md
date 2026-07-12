# AutoCLI Setup

Career-Ops can use [AutoCLI](https://github.com/nashsu/AutoCLI) as a discovery layer for sources like Boss and LinkedIn, then keep using the existing Career-Ops pipeline for filtering, CV tailoring, tracking, and interview prep.

## What Changes

- `AutoCLI` does the "find" step against your logged-in browser session.
- `career-ops` still does the rest: filter, adapt CV, track, and prepare.
- The canonical outputs stay the same: `data/pipeline.md`, `data/scan-history.tsv`, `reports/`, `output/`.

## Install AutoCLI

Windows:

```powershell
Invoke-WebRequest -Uri "https://github.com/nashsu/autocli/releases/latest/download/autocli-x86_64-pc-windows-msvc.zip" -OutFile autocli.zip
Expand-Archive autocli.zip -DestinationPath .
Move-Item autocli.exe "$env:LOCALAPPDATA\Microsoft\WindowsApps\"
```

Then follow the AutoCLI Chrome extension setup from its README so browser commands can reuse your Boss/LinkedIn login session.

## Configure `portals.yml`

Copy the template if you have not already:

```bash
cp templates/portals.example.yml portals.yml
```

Enable and customize the `autocli_sources` section. Example:

```yml
autocli_sources:
  - name: Boss直聘 — AI/后端
    platform: boss
    enabled: true
    command:
      - autocli
      - boss
      - search
      - AI backend engineer
      - --limit
      - "30"
      - --format
      - json
    fields:
      title: jobName
      url: jobUrl
      company: brandName
      location: cityName
```

Notes:

- `command` can be a YAML array or a shell string. Prefer the array form.
- The command must return JSON.
- `results_path` is optional. Use it when the array lives under a nested JSON field like `data.items`.
- `fields` maps AutoCLI output fields into Career-Ops canonical fields.

## Run It

```bash
npm run scan
```

Useful variants:

```bash
node scan.mjs --source boss
node scan.mjs --source linkedin --dry-run
node scan.mjs --company Anthropic
```

## Recommended Flow

1. Run `node scan.mjs --source boss --dry-run` until the mapping looks right.
2. Run `npm run scan` to ingest results into `data/pipeline.md`.
3. Use your AI CLI of choice to process the new offers through the normal Career-Ops flow.

## Mapping Tips

- If every row is being skipped, your `fields.title` / `fields.url` mapping is probably wrong.
- If JSON parsing fails, run the AutoCLI command directly and confirm it includes `--format json`.
- If duplicates are skipped unexpectedly, check `data/pipeline.md` and `data/applications.md` for prior entries.
