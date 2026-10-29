# elasticSA

Elasticsearch 9.x **vector search**, **hybrid search**, and **observability** materials for Solutions Architecture (SA) work: live demos, Jupyter hands-on labs, and a full-stack enterprise search PoV.

한국어: [README.ko.md](README.ko.md)

---

## What’s in this repo

| Path | What it is |
|------|------------|
| [`search-demo/`](search-demo/) | Full-stack enterprise knowledge search PoV (React + Express + Elastic Cloud) |
| [`vector_demo/`](vector_demo/) | Jupyter live demo: Elastic 9.x `semantic_text`, BBQ, ACORN-1 vs 8.x ingest pipelines |
| [`hands_on/`](hands_on/) | Deep-dive Jupyter labs covering HNSW, hybrid retrievers, ES\|QL, RAG |
| [`.devcontainer/vector_demo/`](.devcontainer/vector_demo/) | Dev Container / Codespaces setup for the vector demo notebooks |

Target stack: **Elasticsearch / Kibana 9.x** on Elastic Cloud (ECH), with Elastic Inference Service (Jina embeddings and rerankers).

---

## Repository layout

```
elasticSA/
├── search-demo/          # Hybrid search + APM + Agent Builder web app
├── vector_demo/          # Setup + live-demo notebooks (KLUE Korean news)
├── hands_on/             # Education / PoC notebooks
├── .devcontainer/        # Python 3.11 container for vector_demo
├── LICENSE               # MIT
└── README.md
```

---

## 1. `search-demo` — Enterprise Knowledge Search PoV

A single-page app that compares **Lexical (BM25)**, **Vector (semantic)**, and **Hybrid (FORK + FUSE + RERANK)** on the same Korean/English enterprise knowledge corpus, while streaming traces to Kibana Observability. An AI chat panel talks to Kibana Agent Builder over the same index.

Full setup, query DSL, APM, and seeding docs: **[`search-demo/README.md`](search-demo/README.md)** (Korean).

### Architecture (short)

```
Browser (React + Vite :5173, APM RUM)
    │  HTTP + W3C traceparent
    ▼
Express API (:3000, elastic-apm-node)
    ├── POST /api/search  → Elasticsearch (lexical / vector / hybrid)
    ├── POST /api/chat    → Kibana Agent Builder Converse API
    └── GET  /api/health
```

### Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 8, Tailwind CSS, `@elastic/apm-rum` |
| Backend | Node.js ≥ 20, Express, `@elastic/elasticsearch`, `elastic-apm-node` |
| Data | Elasticsearch 9.3+ index `enterprise-knowledge` (~100k docs via `seed-data.js`) |
| Observability | APM RUM (browser) + APM Node agent; Kibana APM / Discover |
| AI | Kibana Agent Builder agent named `search-demo` |

### Quick start

Prerequisites: Node.js 20+, Elastic Cloud (ES + Kibana 9.x), inference model `.jina-embeddings-v5-text-small`, reranker endpoint `my-jina-reranker`.

```bash
cd search-demo
# create .env (see search-demo/README.md — never commit it)
cd backend && npm install
cd ../frontend && npm install
cd ..
./start.sh          # or: ./start.sh backend | ./start.sh frontend
```

- UI: http://localhost:5173  
- Health: http://localhost:3000/api/health  

Seed the index (embedding generation makes 100k docs take ~20–40 minutes):

```bash
cd search-demo/backend
node seed-data.js                 # 100,000 docs
node seed-data.js --count=10000
node seed-data.js --force         # recreate index
```

Search modes in the UI: Lexical, Vector, Hybrid, and **3-way compare**. The header also has APM error-simulation buttons for Observability demos.

---

## 2. `vector_demo` — Elastic 9.x live demo notebooks

Korean KLUE (`klue/ynat`) news is indexed twice so you can A/B **legacy 8.x** vs **modern 9.x**:

| Notebook | Role |
|----------|------|
| [`1_setup_data.ipynb`](vector_demo/1_setup_data.ipynb) | Connect, deploy Jina EIS models, build both index architectures, bulk-index KLUE, tag ~1% of docs `access_level: premium` for sparse-filter tests |
| [`2_live_demo.ipynb`](vector_demo/2_live_demo.ipynb) | Live talk track: stored vectors, logical vs physical docs, BBQ RAM, ACORN-1, Retriever + rerank, ES\|QL `FORK` / `FUSE` |

**Legacy path:** `float32` `dense_vector` + ingest inference pipeline.  
**Modern path:** `semantic_text` with `bfloat16` storage and **BBQ** (1-bit) HNSW in RAM, then rescoring from full-precision vectors on disk.

Python deps: [`vector_demo/requirements.txt`](vector_demo/requirements.txt) (`elasticsearch`, `numpy`, `datasets`, `jupyter`, `ipykernel`).

Open in a Dev Container / Codespace via [`.devcontainer/vector_demo/devcontainer.json`](.devcontainer/vector_demo/devcontainer.json) (Python 3.11 image, Jupyter extension, `pip install -r requirements.txt`). You will be prompted for `ES_URL` / credentials (or `ES_URL` env).

---

## 3. `hands_on` — Vector search deep-dive labs

Two Jupyter tracks for training and PoCs on Elasticsearch 9.x. Queries are shown as **Query DSL and ES\|QL** where relevant. Typical environment: Elastic Cloud + GitHub Codespaces (`ES_CLOUD_ID` / `ES_API_KEY` or `ES_URL`).

### [`Vector_Search_Deep_Dive_Hands_On_PoC.ipynb`](hands_on/Vector_Search_Deep_Dive_Hands_On_PoC.ipynb)

Concept-first PoC, parts 0–6:

| Part | Topic |
|------|--------|
| 0 | Lexical vs vector (BM25 gaps, multilingual/synonym cases) |
| 1 | HNSW internals (`M`, `ef_construction`, `num_candidates`) + ACORN |
| 2 | Inference endpoints, bi-encoder vs cross-encoder |
| 3 | Chunking: `semantic_text` vs manual `dense_vector` |
| 4 | Quantization: BBQ / DiskBBQ vs float32 |
| 5 | Hybrid: RRF, linear, reranker, ES\|QL `FORK` / `FUSE` / `RERANK` |
| 6 | RAG / context engineering (`min_score` cutoff) |

Note: `FORK`/`FUSE` are 9.1+ tech preview; `RERANK`/`COMPLETION` are 9.2+ tech preview.

### [`vector-search-deepdive-handson.ipynb`](hands_on/vector-search-deepdive-handson.ipynb)

Sectioned lab (~40 min core / ~2 h full) using EIS models `.jina-embeddings-v5-text-small` and `.jina-reranker-v2-base-multilingual`:

| Track | Sections | Time |
|-------|----------|------|
| **Core** | §1–4, §7, §9, §11 — endpoints, `semantic_text`, semantic query, RRF, rerank, 3-stage pipeline | ~40 min |
| **Advanced** | §5–6, §8, §10, §12–13 — `dense_vector`, `_explain`, linear retriever, `min_score`, filters, ACORN-1 | ~30 min |
| **Expert** | §14–18 — multi-field hybrid, BBQ size, alias/model swap, ES\|QL, ops checks | ~20 min |
| **Applied** | §20 — IT-support / chatbot search scenario | ~15 min |

§19 is cleanup; the appendix is a quick reference for field types, score fusion, and key parameters.

---

## Typical prerequisites

Depends on which folder you run:

- **search-demo:** Node.js ≥ 20, npm ≥ 10, Elastic Cloud 9.x, inference + reranker models, optional Agent Builder agent `search-demo`
- **Notebooks:** Python 3.11, Jupyter, `elasticsearch` client, Elastic Cloud 9.x, Jina EIS endpoints

Do not commit `.env`, API keys, or Cloud IDs (see [`.gitignore`](.gitignore)).

---

## License

[MIT](LICENSE) — Copyright (c) 2026 moon.
