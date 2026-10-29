# elasticSA

Elasticsearch 9.x **벡터 검색**, **하이브리드 검색**, **Observability**를 Solutions Architecture(SA) 업무에 바로 쓸 수 있게 모은 자료입니다. 라이브 데모, Jupyter 핸즈온, 엔터프라이즈 검색 PoV 앱이 포함되어 있습니다.

English: [README.md](README.md)

---

## 이 저장소에 있는 것

| 경로 | 내용 |
|------|------|
| [`search-demo/`](search-demo/) | 엔터프라이즈 지식 검색 PoV 풀스택 앱 (React + Express + Elastic Cloud) |
| [`vector_demo/`](vector_demo/) | Jupyter 라이브 데모: Elastic 9.x `semantic_text`, BBQ, ACORN-1 vs 8.x 인제스트 파이프라인 |
| [`hands_on/`](hands_on/) | HNSW, 하이브리드 Retriever, ES\|QL, RAG까지 다루는 딥다이브 랩 |
| [`.devcontainer/vector_demo/`](.devcontainer/vector_demo/) | 벡터 데모 노트북용 Dev Container / Codespaces 설정 |

대상 스택: Elastic Cloud(ECH)의 **Elasticsearch / Kibana 9.x**, Elastic Inference Service(Jina 임베딩·리랭커).

---

## 저장소 구조

```
elasticSA/
├── search-demo/          # 하이브리드 검색 + APM + Agent Builder 웹앱
├── vector_demo/          # 셋업 + 라이브 데모 노트북 (KLUE 한국어 뉴스)
├── hands_on/             # 교육 / PoC 노트북
├── .devcontainer/        # vector_demo용 Python 3.11 컨테이너
├── LICENSE               # MIT
└── README.md
```

---

## 1. `search-demo` — 엔터프라이즈 지식 검색 PoV

같은 한/영 혼합 사내 지식 코퍼스에 대해 **Lexical(BM25)**, **Vector(시맨틱)**, **Hybrid(FORK + FUSE + RERANK)** 결과를 한 화면에서 비교하고, 그 과정에서 생기는 추적을 Kibana Observability로 보냅니다. AI 채팅 패널은 동일 인덱스를 대상으로 Kibana Agent Builder와 대화합니다.

설치, 쿼리 DSL, APM, 시딩 상세: **[`search-demo/README.md`](search-demo/README.md)**.

### 아키텍처 (요약)

```
Browser (React + Vite :5173, APM RUM)
    │  HTTP + W3C traceparent
    ▼
Express API (:3000, elastic-apm-node)
    ├── POST /api/search  → Elasticsearch (lexical / vector / hybrid)
    ├── POST /api/chat    → Kibana Agent Builder Converse API
    └── GET  /api/health
```

### 기술 스택

| 레이어 | 기술 |
|-------|------|
| Frontend | React 19, Vite 8, Tailwind CSS, `@elastic/apm-rum` |
| Backend | Node.js ≥ 20, Express, `@elastic/elasticsearch`, `elastic-apm-node` |
| Data | Elasticsearch 9.3+ 인덱스 `enterprise-knowledge` (`seed-data.js`로 약 10만 건) |
| Observability | APM RUM(브라우저) + APM Node 에이전트, Kibana APM / Discover |
| AI | Kibana Agent Builder 에이전트 이름 `search-demo` |

### 빠른 시작

필요 조건: Node.js 20+, Elastic Cloud(ES + Kibana 9.x), 추론 모델 `.jina-embeddings-v5-text-small`, 리랭커 엔드포인트 `my-jina-reranker`.

```bash
cd search-demo
# .env 생성 (search-demo/README.md 참고 — 커밋하지 말 것)
cd backend && npm install
cd ../frontend && npm install
cd ..
./start.sh          # 또는: ./start.sh backend | ./start.sh frontend
```

- UI: http://localhost:5173  
- Health: http://localhost:3000/api/health  

인덱스 시딩(임베딩 때문에 10만 건은 약 20–40분):

```bash
cd search-demo/backend
node seed-data.js                 # 100,000건
node seed-data.js --count=10000
node seed-data.js --force         # 인덱스 재생성
```

UI 검색 모드: Lexical, Vector, Hybrid, **3-way 비교**. 헤더의 APM 에러 시뮬레이션 버튼으로 Observability 시연이 가능합니다.

---

## 2. `vector_demo` — Elastic 9.x 라이브 데모 노트북

한국어 KLUE(`klue/ynat`) 뉴스를 두 방식으로 색인해 **레거시 8.x**와 **모던 9.x**를 A/B 합니다.

| 노트북 | 역할 |
|----------|------|
| [`1_setup_data.ipynb`](vector_demo/1_setup_data.ipynb) | 접속, Jina EIS 모델 배포, 두 인덱스 아키텍처 구성, KLUE 대량 색인, 희소 필터용으로 약 1% 문서에 `access_level: premium` 태깅 |
| [`2_live_demo.ipynb`](vector_demo/2_live_demo.ipynb) | 시연 트랙: 저장된 벡터, 논리 vs 물리 문서, BBQ RAM, ACORN-1, Retriever + 리랭크, ES\|QL `FORK` / `FUSE` |

**레거시:** `float32` `dense_vector` + 인제스트 inference 파이프라인.  
**모던:** `semantic_text` + `bfloat16` 저장 + RAM의 **BBQ**(1-bit) HNSW, 이후 디스크의 고정밀 벡터로 rescoring.

Python 의존성: [`vector_demo/requirements.txt`](vector_demo/requirements.txt) (`elasticsearch`, `numpy`, `datasets`, `jupyter`, `ipykernel`).

[`.devcontainer/vector_demo/devcontainer.json`](.devcontainer/vector_demo/devcontainer.json)으로 Dev Container / Codespace에서 열 수 있습니다(Python 3.11, Jupyter 확장, `pip install -r requirements.txt`). `ES_URL` / 자격 증명 입력 또는 `ES_URL` 환경변수가 필요합니다.

---

## 3. `hands_on` — 벡터 검색 딥다이브 랩

Elasticsearch 9.x 교육·PoC용 Jupyter 트랙 두 개입니다. 쿼리는 가능한 한 **Query DSL과 ES\|QL을 함께** 보여 줍니다. 일반적인 환경은 Elastic Cloud + GitHub Codespaces(`ES_CLOUD_ID` / `ES_API_KEY` 또는 `ES_URL`)입니다.

### [`Vector_Search_Deep_Dive_Hands_On_PoC.ipynb`](hands_on/Vector_Search_Deep_Dive_Hands_On_PoC.ipynb)

개념 중심 PoC, Part 0–6:

| Part | 주제 |
|------|--------|
| 0 | Lexical vs Vector (BM25 한계, 다국어·동의어) |
| 1 | HNSW 내부 (`M`, `ef_construction`, `num_candidates`) + ACORN |
| 2 | Inference Endpoint, Bi-encoder vs Cross-encoder |
| 3 | 청킹: `semantic_text` vs 수동 `dense_vector` |
| 4 | 양자화: BBQ / DiskBBQ vs float32 |
| 5 | Hybrid: RRF, Linear, Reranker, ES\|QL `FORK` / `FUSE` / `RERANK` |
| 6 | RAG / Context Engineering (`min_score` cutoff) |

참고: `FORK`/`FUSE`는 9.1+ tech preview, `RERANK`/`COMPLETION`은 9.2+ tech preview입니다.

### [`vector-search-deepdive-handson.ipynb`](hands_on/vector-search-deepdive-handson.ipynb)

섹션형 랩(코어 약 40분 / 전체 약 2시간). EIS 모델 `.jina-embeddings-v5-text-small`, `.jina-reranker-v2-base-multilingual` 사용:

| 트랙 | 섹션 | 시간 |
|-------|----------|------|
| **Core** | §1–4, §7, §9, §11 — Endpoint, `semantic_text`, Semantic Query, RRF, 리랭크, 3단계 파이프라인 | ~40분 |
| **Advanced** | §5–6, §8, §10, §12–13 — `dense_vector`, `_explain`, Linear Retriever, `min_score`, 필터, ACORN-1 | ~30분 |
| **Expert** | §14–18 — 멀티필드 하이브리드, BBQ 용량, alias/모델 교체, ES\|QL, 운영 점검 | ~20분 |
| **Applied** | §20 — IT 지원 / 챗봇 검색 시나리오 | ~15분 |

§19는 정리(cleanup), 부록은 필드 타입·스코어 결합·핵심 파라미터 퀵 레퍼런스입니다.

---

## 공통 사전 요구사항

실행하는 폴더에 따라 다릅니다.

- **search-demo:** Node.js ≥ 20, npm ≥ 10, Elastic Cloud 9.x, 추론·리랭커 모델, (선택) Agent Builder 에이전트 `search-demo`
- **노트북:** Python 3.11, Jupyter, `elasticsearch` 클라이언트, Elastic Cloud 9.x, Jina EIS 엔드포인트

`.env`, API Key, Cloud ID는 커밋하지 마세요. ([`.gitignore`](.gitignore) 참고)

---

## 라이선스

[MIT](LICENSE) — Copyright (c) 2026 moon.
