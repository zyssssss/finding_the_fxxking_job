# Company Seed Discovery

This workflow is for when you already have a company list from a source like KDocs and want to:

1. filter companies by industry and company nature
2. discover official social-career URLs
3. search Boss for matching roles
4. save JD files and append matches into the normal Career-Ops pipeline

## Files

- `data/company-seeds.json` → raw extracted company seeds
- `config/company-discovery.yml` → discovery rules and query templates
- `data/company-seeds.filtered.json` → filtered seed list
- `data/company-opportunities.json` → structured discovery output
- `data/company-opportunities.md` → readable report
- `jds/*.md` → saved Boss JD files
- `data/pipeline.md` → appended Career-Ops pending items

## Input Format

Use `templates/company-seeds.example.json` as the shape:

```json
[
  {
    "company_name": "腾讯",
    "industry": "互联网",
    "company_nature": "民营企业"
  }
]
```

## Commands

Filter raw seeds:

```bash
npm run seeds:filter
```

Discover opportunities from filtered seeds:

```bash
npm run seeds:discover -- --limit 20
```

Only run a specific company:

```bash
npm run seeds:discover -- --company 腾讯
```

Generate report without appending to pipeline:

```bash
npm run seeds:discover -- --no-pipeline
```

## Current Heuristics

- company nature must be one of: `民营企业`, `外企`, `港澳合资`
- industries are prioritized by `config/company-discovery.yml`
- official career discovery uses `AutoCLI google search`
- role discovery uses `AutoCLI boss search` + `boss detail`
- Boss matches must pass the existing `portals.yml` title filter

## Notes

- Official career URLs are discovered first, but current JD capture is only automated for Boss.
- Boss matches are written into `jds/` and `data/pipeline.md` with both `apply:` and `careers:` URLs.
- This workflow is designed to plug into Career-Ops, not replace it.
