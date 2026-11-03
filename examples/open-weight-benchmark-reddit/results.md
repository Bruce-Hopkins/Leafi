# Open-weight benchmark sweep vs. Reddit — results

Run date: 2026-10-28. Flow: `flow.json` (4 nodes: papers → tables + reddit in parallel → report).

**Provenance**

| Field | Value |
|---|---|
| Run id | `db16ae84-f99e-459e-b23c-f7ea8353dc11` |
| Status | `completed` |
| Flow | Open-weight benchmark survey + Reddit reality check |
| Workspace | `~/.agents-automations/workspaces/db16ae84-f99e-459e-b23c-f7ea8353dc11/` |

| Node | Model | Iterations | Input tokens | Output tokens |
|---|---|---|---|---|
| papers | deepseek/deepseek-v4.1-flash | 8 | 68,653 | 29,190 |
| tables | deepseek/deepseek-v4.1-flash | 4 | 42,281 | 9,504 |
| reddit | deepseek/deepseek-v4.1-flash | 7 | 84,212 | 21,634 |
| report | deepseek/deepseek-v4.1-flash | 1 | 11,378 | 9,020 |

Totals: 206,524 input + 69,348 output tokens, about $0.058 at OpenRouter list price
($0.14/M input, $0.42/M output). This run predates billed-cost reporting; the CLI now reports
OpenRouter's billed cost in `costUsd`.

**Sources and method**

- Papers: Semantic Scholar bulk search, `minCitationCount=5`, `sort=citationCount:desc`, plus a
  model-family query so landmark reports that never say "open-weight" are still found. 20 papers.
- Tables: numbers parsed from each paper's own arXiv HTML result tables (ar5iv fallback).
  13 of 20 papers exposed a usable table; the other 7 publish results as images or PDF-only and
  contribute no score rows. Those papers are named in the report.
- Reddit: PullPush comment archive, top-scored comments per model, retrieved 2026-10-28.
- Every number is copied from the source, never averaged across benchmarks or harnesses. Cells the
  source does not report are em dashes.

**How to re-run**

```bash
cd examples/open-weight-benchmark-reddit
node ../../dist/main.js validate --graph flow.json     # free
BASH_TIMEOUT_MS=900000 node ../../dist/main.js run \
  --graph flow.json --json --env-file ~/.hermes/.env
```

---

This sweep covers 20 papers on open-weight models, 2023–2025, from LLaMA 7B-era releases to LFM2-350M, all above a floor of 5 citations and with no date window. The extracted result tables exposed 13 of those 20 papers (arXiv 2302.13971, 2311.16867, 2401.02385, 2405.04434, 2406.12793, 2407.21783, 2408.00118, 2412.08905, 2412.15115, 2501.00656, 2503.19786, 2505.09388, 2508.06471, 2511.23404), so seven papers — Gemma 2 27B's own report, DeepSeekMath 7B, Phi-3-mini, GLM-4, OLMo 7B, TÜLU 3 70B and LFM2-2.6B as separate lines — contribute no score rows here beyond what sibling reports re-list. Judging on MMLU, the strongest open-weight row is Qwen3-235B-A22B at 87.81 (arXiv 2505.09388), ahead of GLM-4.5 at 86.1 (2508.06471) and Qwen2.5-72B at 86.06 (2505.09388). Licence is stated in the notes only for Qwen3 (Apache 2.0); for essentially every other row the licence is not stated.

## Benchmark results, open-weight models

| Paper | Model | MMLU | MMLU-Pro | GPQA | GSM8K | MATH | HumanEval | IFEval | HellaSwag | ARC | BBH | LiveCodeBench | MBPP | WinoGrande | PIQA | TriviaQA | DROP | AGIEval | BoolQ | MMLU-Redux |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2302.13971 | LLaMA | — | — | — | — | — | — | — | 76.1 | 72.8 | — | — | — | 70.1 | 79.8 | — | — | — | 76.5 | — |
| 2401.02385 | TinyLlama v1.0 | — | — | — | — | — | — | — | 59.20 | 30.12 | — | — | — | 59.12 | 73.29 | — | — | — | 57.83 | — |
| 2401.02385 | TinyLlama v1.1 | — | — | — | — | — | — | — | 61.47 | 32.68 | — | — | — | 59.43 | 73.56 | — | — | — | 55.99 | — |
| 2401.02385 | TinyLlama v1.1 Chinese | — | — | — | — | — | — | — | 58.23 | 31.40 | — | — | — | 59.27 | 73.01 | — | — | — | 61.41 | — |
| 2401.02385 | OPT-1.3B | — | — | — | — | — | — | — | 53.65 | 29.44 | — | — | — | 59.59 | 72.36 | — | — | — | 60.83 | — |
| 2405.04434 | DeepSeek 67B | 71.3 | — | — | — | 63.4 | 45.1 | — | 86.3 | 95.3 | 68.7 | — | 57.4 | 84.9 | 83.6 | 78.9 | 69.7 | 41.3 | — | — |
| 2405.04434 | DeepSeek-V2 | 78.5 | — | — | — | 79.2 | 48.8 | — | 84.2 | 97.6 | 78.9 | — | 66.6 | 84.9 | 83.7 | 79.9 | 80.1 | 51.2 | — | — |
| 2405.04434 | Qwen1.5 72B | 77.2 | — | — | — | 77.9 | 43.9 | — | 85.8 | 97.1 | 59.9 | — | 53.6 | 82.4 | 83.3 | 73.1 | 71.5 | 64.4 | — | — |
| 2405.04434 | Mixtral | 77.6 | — | — | — | 80.3 | 53.1 | — | 86.6 | 97.3 | 78.9 | — | 64.2 | 83.7 | 83.6 | 82.1 | 80.4 | 43.4 | — | — |
| 2406.12793 | ChatGLM3-6B-Base | 61.4 | — | 26.8 | 72.3 | 25.7 | 58.5 | — | 79.7 | — | 66.1 | — | — | — | 80.1 | — | 70.9 | — | 87.9 | — |
| 2406.12793 | GLM-4-9B | 74.7 | — | 34.3 | 84.0 | 30.4 | 70.1 | — | 82.6 | — | 76.3 | — | — | — | 79.1 | — | 77.2 | — | 89.6 | — |
| 2406.12793 | ChatGLM-6B | 25.2 | — | — | 1.5 | 3.1 | 0.0 | — | 30.4 | — | 0.0 | — | — | — | 65.7 | — | 3.9 | — | 51.8 | — |
| 2406.12793 | ChatGLM2-6B | 45.2 | — | — | 25.9 | 6.9 | 9.8 | — | 57.0 | — | 29.2 | — | — | — | 69.6 | — | 25.6 | — | 79.0 | — |
| 2407.21783 | Llama 3 8B | 69.4 | 48.3 | 32.8 | — | 84.5 | 72.6 | 80.4 | — | 83.4 | — | — | 72.8 | — | — | — | — | — | — | — |
| 2407.21783 | Llama 3 70B | 83.6 | 66.4 | 46.7 | — | 95.1 | 80.5 | 87.5 | — | 94.8 | — | — | 86.0 | — | — | — | — | — | — | — |
| 2407.21783 | Llama 3 405B | 87.3 | 73.3 | 51.1 | — | 96.8 | 89.0 | 88.6 | — | 96.9 | — | — | 88.6 | — | — | — | — | — | — | — |
| 2407.21783 | Mistral 7B | 61.1 | 36.9 | 28.8 | — | 53.2 | 40.2 | 57.6 | — | 74.2 | — | — | 49.5 | — | — | — | — | — | — | — |
| 2408.00118 | Gemma-1 2B | 42.3 | — | — | 15.1 | 11.8 | 22.0 | — | 71.7 | 48.5 | 35.2 | — | 29.2 | 66.8 | 77.3 | 53.2 | 48.5 | 24.2 | 69.4 | — |
| 2408.00118 | Gemma-2 2B | 52.2 | — | — | 24.3 | 16.0 | 20.1 | — | 72.9 | 55.7 | 41.9 | — | 30.2 | 71.3 | 78.4 | 60.4 | 51.2 | 31.5 | 72.7 | — |
| 2408.00118 | Gemma-2 9B | 71.3 | — | — | 68.6 | 36.6 | 40.2 | — | 81.9 | 68.4 | 68.2 | — | 52.4 | 80.6 | 81.7 | 76.6 | 69.4 | 52.8 | 84.2 | — |
| 2408.00118 | Gemma-2 27B | 75.2 | — | — | 74.0 | 42.3 | 51.8 | — | 86.4 | 71.4 | 74.9 | — | 62.6 | 83.7 | 83.2 | 83.7 | 74.2 | 55.1 | 84.8 | — |
| 2412.08905 | phi-4 (stage 1 + 2) | 84.8 | — | 56.1 | — | 80.4 | 82.6 | 63.0 | — | — | — | — | — | — | — | — | 75.5 | — | — | — |
| 2412.08905 | DPO stage 1 | 84.8 | — | 53.6 | — | 80.5 | 81.6 | 63.0 | — | — | — | — | — | — | — | — | 86.1 | — | — | — |
| 2412.08905 | DPO stage 2 only | 84.2 | — | 52.4 | — | 77.6 | 81.5 | 63.0 | — | — | — | — | — | — | — | — | 71.8 | — | — | — |
| 2412.15115 | Qwen2.5-0.5B | 47.5 | 15.7 | 24.8 | 41.6 | 19.5 | 30.5 | — | 52.1 | 35.6 | 20.3 | — | 39.3 | 56.3 | — | — | — | — | — | 45.1 |
| 2412.15115 | Qwen2.5-1.5B | 60.9 | 28.5 | 24.2 | 68.5 | 35.0 | 37.2 | — | 67.9 | 54.7 | 45.1 | — | 60.2 | 65.0 | — | — | — | — | — | 58.5 |
| 2412.15115 | Qwen2.5-3B | 65.6 | 34.6 | 26.3 | 79.1 | 42.6 | 42.1 | — | 74.6 | 56.5 | 56.3 | — | 57.1 | 71.1 | — | — | — | — | — | 63.7 |
| 2412.15115 | Qwen2-0.5B | 44.3 | 14.7 | 29.8 | 36.4 | 11.2 | 22.6 | — | 49.1 | 31.0 | 18.2 | — | 33.1 | 56.9 | — | — | — | — | — | 40.7 |
| 2501.00656 | OLMo 1B 0724 | 36.6 | — | — | 10.8 | 2.2 | — | — | — | — | 29.9 | — | — | — | — | — | 27.9 | — | — | — |
| 2501.00656 | OLMo 7B 0424 | 48.9 | — | — | 23.2 | 5.2 | — | — | — | — | 34.4 | — | — | — | — | — | 47.9 | — | — | — |
| 2501.00656 | OLMo 2 1B | 40.0 | — | — | 68.3 | 20.7 | — | — | — | — | 35.0 | — | — | — | — | — | 34.6 | — | — | — |
| 2501.00656 | OLMo 2 7B | 61.3 | — | — | 85.1 | 32.5 | — | — | — | — | 51.4 | — | — | — | — | — | 60.5 | — | — | — |
| 2503.19786 | Gemma 2 2B | 56.1 | — | — | 62.6 | 27.2 | 20.1 | 80.4 | — | — | 41.4 | 7.0 | 36.6 | — | — | — | — | — | — | — |
| 2503.19786 | Gemma 2 9B | 71.3 | — | — | 88.1 | 49.4 | 40.2 | 88.4 | — | — | 69.0 | 20.0 | 59.2 | — | — | — | — | — | — | — |
| 2503.19786 | Gemma 2 27B | 76.2 | — | — | 91.1 | 55.6 | 51.8 | 91.1 | — | — | 74.9 | 29.0 | 67.4 | — | — | — | — | — | — | — |
| 2503.19786 | Gemma 3 1B | 38.8 | — | — | 62.8 | 48.0 | 41.5 | 80.2 | — | — | 39.1 | 5.0 | 35.2 | — | — | — | — | — | — | — |
| 2505.09388 | Qwen3-235B-A22B | 87.81 | 68.18 | 47.47 | 94.39 | 71.84 | — | — | — | — | 88.87 | — | 81.40 | — | — | — | — | — | — | 87.40 |
| 2505.09388 | Qwen2.5-72B | 86.06 | 58.07 | 45.88 | 91.50 | 62.12 | — | — | — | — | 86.30 | — | 76.00 | — | — | — | — | — | — | 83.91 |
| 2505.09388 | Qwen2.5-Plus | 85.02 | 63.52 | 41.92 | 91.89 | 62.78 | — | — | — | — | 85.60 | — | 74.60 | — | — | — | — | — | — | 82.69 |
| 2505.09388 | Llama-4-Maverick | 85.16 | 63.91 | 43.94 | 87.72 | 63.32 | — | — | — | — | 83.62 | — | 75.40 | — | — | — | — | — | — | 84.05 |
| 2508.06471 | GLM-4.5 | 86.1 | — | — | — | 79.4 | — | — | 87.1 | — | 86.2 | 28.1 | — | — | 85.3 | 80.0 | — | — | — | — |
| 2508.06471 | DeepSeek-V3 | 87.2 | — | — | — | 87.6 | — | — | 88.9 | — | 88.4 | 24.6 | — | — | 84.7 | 82.9 | — | — | — | — |
| 2508.06471 | Kimi-K2 | 87.8 | — | — | — | 92.1 | — | — | 94.6 | — | 88.7 | 26.3 | — | — | — | 85.1 | — | — | — | — |
| 2508.06471 | Llama4-Maverick | 85.2 | — | — | — | 87.7 | — | — | — | — | 87.1 | 25.1 | — | — | — | — | — | — | — | — |
| 2511.23404 | LFM2-350M 0.35B | 43.43 | 15.85 | 27.46 | 30.10 | 24.20 | — | 65.12 | — | — | — | — | — | — | — | — | — | — | — | — |
| 2511.23404 | LFM2-700M 0.70B | 49.90 | 18.65 | 28.48 | 46.40 | 31.80 | — | 72.23 | — | — | — | — | — | — | — | — | — | — | — | — |
| 2511.23404 | LFM2-1.2B 1.2B | 55.23 | 19.71 | 31.47 | 58.30 | 42.40 | — | 74.89 | — | — | — | — | — | — | — | — | — | — | — | — |
| 2511.23404 | Qwen3-0.6B 0.6B | 44.93 | 27.02 | 22.14 | 36.47 | 48.60 | — | 64.24 | — | — | — | — | — | — | — | — | — | — | — | — |

## Closed-weight results reported in the same tables

| Paper | Model | MMLU | MMLU-Pro | GPQA | GSM8K | MATH | HumanEval | IFEval | HellaSwag | ARC | BBH | LiveCodeBench | MBPP | WinoGrande | PIQA | TriviaQA | DROP | AGIEval | BoolQ | MMLU-Redux |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2302.13971 | PaLM | — | — | — | — | — | — | — | 79.7 | 75.2 | — | — | — | 77.0 | 80.5 | — | — | — | 84.8 | — |
| 2302.13971 | PaLM-cont | — | — | — | — | — | — | — | 80.6 | — | — | — | — | 77.0 | 81.4 | — | — | — | 83.9 | — |
| 2311.16867 | GPT-3.5 | 70.0 | — | — | — | — | — | — | 85.5 | 85.2 | — | — | — | 81.6 | — | — | — | — | — | — |
| 2311.16867 | GPT-4 | 86.5 | — | — | — | — | — | — | 95.3 | 96.3 | — | — | — | 87.5 | — | — | — | — | — | — |
| 2407.21783 | GPT 3.5 Turbo | 70.7 | 49.2 | 30.8 | — | 81.6 | 68.0 | 69.9 | — | 83.7 | — | — | 82.0 | — | — | — | — | — | — | — |
| 2407.21783 | GPT-4 (0125) | 85.1 | 64.8 | 41.4 | — | 94.2 | 86.6 | 84.3 | — | 96.4 | — | — | 83.6 | — | — | — | — | — | — | — |
| 2407.21783 | GPT-4o | 89.1 | 74.0 | 53.6 | — | 96.1 | 90.2 | 85.6 | — | 96.7 | — | — | 87.8 | — | — | — | — | — | — | — |
| 2407.21783 | Claude 3.5 Sonnet | 89.9 | 77.0 | 59.4 | — | 71.1 | 92.0 | 88.0 | — | 96.7 | — | — | 90.5 | — | — | — | — | — | — | — |
| 2501.00656 | GPT-3.5 Turbo 0125 | 70.2 | — | — | 74.3 | 41.2 | — | — | — | — | 66.6 | — | — | — | — | — | 70.2 | — | — | — |
| 2501.00656 | GPT 4o Mini 0724 | 82.2 | — | — | 83.0 | 67.9 | — | — | — | — | 65.9 | — | — | — | — | — | 36.3 | — | — | — |

On MMLU, Qwen3-235B-A22B (87.81) sits below GPT-4o (89.1) and Claude 3.5 Sonnet (89.9) but above GPT-4 0125 (85.1) and GPT-4 (86.5) as reported in the same Llama 3 herd table. The gap to the top closed row is roughly 1.3–2.1 MMLU points, and it closes to nothing on MMLU-Redux-style checks, though not every open row has a closed counterpart on every column.

## What Reddit says, against the table

**Qwen3-235B-A22B.** One comment gives numbers that partly corroborate, partly cut: r/LocalLLaMA (33 pts, 2026-03-02) scores it Knowledge & STEM 83, Math 87, Coding 54, General Agent 56, Instruction Following 63, Long Context 57, Multilingualism 75 — high maths, but coding and agentic well below the STEM figure, which the paper's MBPP 81.40 and BBH 88.87 do not signal. r/LocalLLaMA (95 pts, 2026-02-16) reports Qwen3.5-397B-A17B decoding throughput is "3.5x/7.2 times that of Qwen3-235B-A22B," a serving criticism the table cannot show. r/LocalLLaMA (45 pts, 2025-09-11) says the newer non-thinking variant "is less censored than Qwen3 235B A22B Instruct 2507" — no benchmark cell covers refusal behaviour. For a deployment decision I would trust the table for raw capability and the threads for throughput and censorship, since the paper measures neither.

**Qwen2.5-72B.** r/LocalLLaMA (614 pts, 2025-08-02) is outright sceptical of Qwen-lineage numbers: "the technical report screams 'training on test' for me," targeting a derivative Skywork model at AIME/HLE, not this table's cells — but the suspicion is aimed at 72B-derived claims. Positive counterweight at r/LocalLLaMA (59 pts, 2026-03-16): "It was a beast." Two more threads (65 pts, 2026-03-18; 59 pts, 2025-03-04) use 72B as the bar for 32B-class releases. Nobody reproduces the 86.06 MMLU cell; treat the scepticism as a reason to re-run, not a refutation.

**Llama 3.1 405B.** r/hardware (90 pts, 2025-11-19) quotes 16,384 H100 80GB and ~38% MFU, matching the paper's hardware disclosure. r/MachineLearning (12 pts, 2025-04-25) undermines comparability: "Chatbot Arena indicates the 8-bit and 16-bit Llama 3.1 405b tend to behave quite differently" — quantisation, which no table column records. r/LocalLLaMA (52 pts, 2026-06-09) repeats the GPT-4o comparison without a number. No thread reproduces MMLU 87.3 or IFEval 88.6; for deployment I would weight the precision caveat, because it invalidates any war of leaderboard positions.

**GLM-4.5 355B.** r/LocalLLaMA (115 pts, 2025-10-22): "GLM 4.6 is 355B so it's too big for most people." r/LocalLLaMA (43 pts, 2025-10-07) does the fit maths for the smaller sibling — GLM-4.5-Air 106B, Q4 ~60GB, "dual 5090." r/LocalLLaMA (28 pts, 2025-10-11) explains MoE offload for a 111B model. r/singularity (32 pts, 2026-03-17) notes "GLM 4.5 355B Base" was the comparison base, hinting the LiveCodeBench 28.1 and BBH 86.2 are post-training artifacts. The table cannot show any of this; for a small team the VRAM reality outranks the score.

**DeepSeek-V2 236B.** r/LocalLLaMA (106 pts, 2024-10-18) disputes the economy pitch: "qwen2.5 72b is beating out deepseek v2.5, that's a 236b MoE." That contradicts the paper's MMLU 78.5 / MATH 79.2 story by class of outcome — a dense 72B ahead of a larger MoE — but names v2.5, not v2. r/LocalLLaMA (26 pts, 2024-12-10) gives the deployment figure: "q3_k_L took 170gb..... So... Good luck." I would trust the VRAM number for a buying decision and stay agnostic on the quality dispute until I saw the harness.

**LLaMA 7B–65B.** r/ProgrammerHumor (103 pts, 2023-06-03) gives the capability ladder "7b is dumb as a rock, 13b is about toddler... 65b can have good reasoning," tracking the paper's scaling claim without a cell. r/ChatGPT (106 pts, 2023-04-24) undercuts it: a local 13B feels "damn comparable to chatGPT. It's not quite as good, but it's close," not better than GPT-3 as the abstract implied. r/LocalLLaMA (75 pts, 2023-06-20) disputes f16-vs-int4 equivalence; r/Piracy (222 pts, 2023-04-09) tracks the leaked 220GB weights — no stated licence, consistent with the notes. The table's HellaSwag 76.1 cannot adjudicate any of this.

**Mixtral 8x7B.** Treating it as a local workhorse, r/ChatGPT (73 pts, 2024-01-24) recommends "SillyTavern... running something like Mixtral 8x7b." r/SillyTavernAI (7 pts, 2024-09-20) makes a quantisation claim: "Q4 cache quantization with exllamav2... 3bpw to 5bpw... no discernible difference in output quality" — a caveat the MMLU 77.6 / MATH 80.3 row cannot capture. No thread quotes a number.

**Mistral 7B.** Pure commodity framing: r/ProgrammerHumor (170 pts, 2026-06-02) jokes the "difference between Claude and Mistral 7b" doesn't matter; r/selfhosted (7 pts, 2025-06-05) reduces it to "download with Ollama"; r/linuxquestions (14 pts, 2026-03-16) mentions it in a home lab. No MMLU, GSM8K or MT-Bench figure is cited anywhere — the table's 61.1 MMLU is untested by users.

**Phi-4 14B.** r/LocalLLaMA (9 pts, 2025-03-25): "Phi-4 is the GOAT for the work cases... it fill forms, it making jsons." r/LocalLLaMA (8 pts, 2025-11-12) adds the limit: "little general knowledge... handles its (limited) context of 32k really well" — a 32k window the table never shows, and which matters more than DROP 75.5 for a serving decision. r/LocalLLaMA (16 pts, 2026-01-11) recommends the base for finetuning. Adds a caveat the table cannot.

**Phi-3-mini 3.8B.** r/LocalLLaMA (78 pts, 2024-04-24): "impressive for its tiny size... feels almost like a 7b model, but not quite there" — broadly agreeing with the punch-above-weight framing without confirming a cell. r/StableDiffusion (138, 135 pts, 2024-09-20) shows OmniGen "just is an LLM, Phi-3-mini (3.8B)," evidence of reuse, not capability. Note Phi-3-mini's own report contributed no extracted rows here.

**Falcon 180B.** r/LocalLLaMA (14 pts, 2025-05-21) recalls it was "better than llama 2 70b chat at the time," and (14 pts, 2026-06-17) buries it: "Now the Qwen and Gemma 20Bs beat it in everything." r/LocalLLaMA (6 pts, 2024-01-15) is the only evidence-seeker: "Falcon 180b in 8-bit? ... Would love to see a benchmark." This is the clearest case where Reddit's dated consensus and the paper's vintage numbers disagree with present-day use; trust neither for a new deployment.

**Gemma 2 27B and Gemma 3 27B.** Gemma 2 27B: no substantive discussion — r/LocalLLaMA (136 pts) lists "Gemma 31b," (120 pts) is newbie hardware advice, and the r/comfyui (38 pts) hit is gemma-3, not Gemma 2. Gemma 3 27B: r/comfyui (38 pts, 2025-10-20) runs "mlabonne/gemma-3-27b-it-abliterated-GGUF at Q4_K_M at 16k context... LMStudio on 2x rtx3060 (12GB)... about 14 tok/s" — a hardware-fit claim no column shows, and the existence of abliterated GGUF is a licence/practicality signal. No Gemma 3 benchmark number is cited, so the table (MMLU 76.2, GSM8K 91.1) stands unverified.

**TinyLlama 1.1B.** Numbers, but for speed: r/LocalLLaMA (20 pts, 2025-08-12) measures Q4_K_M at "121 s on CPU versus 3 s on GPU" on a Dell E7250. r/LocalLLM (13 pts, 2026-04-14) gives a reliability counterexample: "Hello" answered with a rant about AI in medicine. Nothing cites HellaSwag 61.47 or BoolQ 55.99 — the ARC 32.68 row is effectively untested outside the paper.

**Not discussed: DeepSeekMath 7B, GLM-4, OLMo 7B, OLMo 2 13B, TÜLU 3 70B, LFM2-2.6B.** DeepSeekMath 7B and GLM-4 have only 1-point and name-drop hits. OLMo 7B and OLMo 2 13B share one 129-pt r/LocalLLaMA thread (2024-11-26) about token budgets ("3 trillion... for 7B") and the Dolma mix, which mislabels the 13B checkpoint — the open-data angle, not MMLU, is what users value. TÜLU 3 70B draws only 1-point notes, but r/MistralAI (1 pt, 2025-02-22) reports "Tülu failed" a prompt battery that Mistral, DeepSeek DeepThink, ChatGPT Reason and Grok 3 Think passed — a direct reliability counterexample to frontier-beating IF claims, and r/singularity (1 pt, 2026-09-10) lists it under a Llama licence, the only licence datum surfaced. LFM2-2.6B has none: its search failed with HTTP 000.

**The gap.** Practitioners talk about VRAM, quantisation and refusal behaviour; papers publish MMLU and GSM8K. Where they touch the same thing — Phi-3-mini's size-to-capability, Llama 3.1 405B's precision sensitivity, TÜLU 3's prompt battery — the community either adds a caveat the table structurally cannot hold or contradicts a claim outright. Treat the tables as upper bounds measured under an unstated harness, and Reddit as a consumer-fitness filter applied after the fact.

**Caveats.** Every number above comes from each paper's own result tables under that paper's harness, not from independent evaluation; self-reported scores are not independent evaluations. The citation floor was 5 and there was no date window. The tables cover only what the extracted tables exposed — 13 of the 20 papers — so seven papers contribute no score rows. Reddit evidence is anecdote weighted by upvotes, with small threads (1–20 points) carrying little signal and no thread here reproducing more than one or two numbers from the tables.
