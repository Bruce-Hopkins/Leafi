# arXiv model benchmarks

A four-node flow that finds recent arXiv benchmark papers, extracts the model ×
benchmark scores present in selected excerpts, builds a model-by-benchmark table,
and writes a briefing for a person.

## Prerequisites

- `curl`, Python 3, and `pdftotext` from Poppler.
- An `OPENROUTER_API_KEY` in `.env` or the process environment.
- Network access to Semantic Scholar, arXiv, and OpenRouter.

The flow downloads PDFs, reads excerpts, and makes paid model calls. A run can
take several minutes, and its cost depends on how many papers are selected and
how many model iterations they require.

```bash
node dist/main.js validate --graph examples/arxiv-model-benchmarks/flow.json
node dist/main.js graph --graph examples/arxiv-model-benchmarks/flow.json
node dist/main.js run --graph examples/arxiv-model-benchmarks/flow.json --json
```

```text
[ sources ]──►[ extract ]──►[ table ]──►[ brief ]   audience: person
  search,      model x       table.md     summary of
  download,    benchmark                  the findings
  excerpts     rows
```

## Nodes

| Node | What it does |
| --- | --- |
| `sources` | Runs Semantic Scholar bulk searches over the last 90 days, keeps papers with at least 10 citations and a benchmark or evaluation subject, favours up to four open-weight-focused papers, writes `selected.json`, then downloads each PDF and builds `excerpts/<id>_*.txt`. |
| `extract` | Reads the excerpt parts and writes `rows/<id>.jsonl`, with benchmark records and model × benchmark scores, preserving the model name, metric, and setting as the paper prints them. Extraction is bounded to 120 score rows per paper. |
| `table` | Runs a deterministic script over `rows/*.jsonl` and `selected.json`, writes `table.md` with one row per model and one column per benchmark, plus source papers and notes. |
| `brief` | Reads `table.md` and writes the prose briefing: how many papers, models, and benchmarks are covered, three or four findings, and the caveats. |

All four nodes currently use `deepseek/deepseek-v4.1-flash` through OpenRouter.

## Design notes

- `sources` splits its work across three bash calls; it was written when `BASH_TIMEOUT_MS`
  was 30 seconds by default (now 2 minutes), and downloads are performed per paper.
- Only `brief` is marked `audience: "person"`; the earlier nodes hand over paths
  and counts, never bulk paper text between each other.
- The 90-day window and the 10-citation floor are constraints inside the
  selection script, so a run always reports the window it used.
- Extraction works from selected excerpts rather than the full papers, so the
  table covers the benchmark evidence that survives excerpting, not every score
  in every PDF. `TEXT-UNAVAILABLE` papers are skipped and reported.
- Model names are not normalised. Two papers spelling the same benchmark
  differently produce two columns on purpose: merging them would invent a score
  jump that no paper reported.
