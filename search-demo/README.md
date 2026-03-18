# Enterprise Knowledge Search Demo

Elastic Stack의 **Hybrid Search**, **Observability**, **Agent Builder**를 하나의 화면에서 통합 시연하는 엔터프라이즈 PoV 애플리케이션입니다.

> **시연 목적**: 동일한 검색어로 Lexical(BM25) / Vector(Semantic) / Hybrid(FORK+FUSE+RERANK) 세 가지 검색 방식의 결과를 실시간으로 비교하고, 그 과정에서 생성되는 APM 트랜잭션·스팬·에러를 Kibana Observability로 추적합니다. AI 어시스턴트(Agent Builder 기반)는 동일 인덱스에 대해 자연어 대화 검색을 제공합니다.

---

## 목차

1. [아키텍처 개요](#아키텍처-개요)
2. [기술 스택](#기술-스택)
3. [데이터셋 구조](#데이터셋-구조)
4. [인덱스 매핑 상세](#인덱스-매핑-상세)
5. [검색 쿼리 상세 설명](#검색-쿼리-상세-설명)
6. [Observability 계측 구조](#observability-계측-구조)
7. [Agent Builder 연동](#agent-builder-연동)
8. [사전 요구사항](#사전-요구사항)
9. [설치 및 실행](#설치-및-실행)
10. [환경변수 설정](#환경변수-설정)
11. [데이터 시딩](#데이터-시딩)
12. [Elasticsearch 사전 설정](#elasticsearch-사전-설정)
13. [APM RUM CORS 설정](#apm-rum-cors-설정)
14. [UI 기능 안내](#ui-기능-안내)
15. [트러블슈팅](#트러블슈팅)

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (User)                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  React SPA (Vite · Tailwind CSS · port 5173)           │    │
│  │  • Lexical / Vector / Hybrid / 3-way 비교 검색 UI      │    │
│  │  • AI 어시스턴트 채팅 패널                              │    │
│  │  • APM RUM (실사용자 트랜잭션 · 에러 수집)             │    │
│  └────────────────┬───────────────────────────────────────┘    │
└───────────────────┼─────────────────────────────────────────────┘
                    │  HTTP + traceparent (W3C Trace Context)
                    ▼
┌───────────────────────────────────────────────────────────────┐
│  Node.js / Express API (port 3000)                            │
│  • elastic-apm-node (APM 자동 계측)                           │
│  • POST /api/search  → Lexical / Vector / Hybrid 라우팅       │
│  • POST /api/chat    → Kibana Agent Builder Converse API      │
│  • GET  /api/health  → 클러스터 상태 확인                     │
└───────┬───────────────────────────────┬───────────────────────┘
        │ @elastic/elasticsearch         │ fetch (Kibana REST API)
        ▼                               ▼
┌───────────────────┐       ┌────────────────────────────┐
│  Elasticsearch    │       │  Kibana                    │
│  (Elastic Cloud)  │       │  • Agent Builder (chat)    │
│  • enterprise-    │       │  • APM UI                  │
│    knowledge idx  │       │  • Discover / Dashboard    │
└───────────────────┘       └────────────────────────────┘
        │                               │
        └───────────────────────────────┘
                    APM Server
          (트랜잭션 · 스팬 · 에러 수집)
```

---

## 기술 스택

| 레이어 | 기술 | 버전 | 역할 |
|---|---|---|---|
| Frontend | React | 19 | SPA UI |
| Frontend | Vite | 8 | 번들러 / 개발 서버 |
| Frontend | Tailwind CSS | 3 | 유틸리티 CSS |
| Frontend | @elastic/apm-rum | 5 | Real User Monitoring |
| Frontend | axios | 1 | HTTP 클라이언트 |
| Backend | Node.js | ≥ 20 | 런타임 (ESM) |
| Backend | Express | 4 | HTTP 프레임워크 |
| Backend | elastic-apm-node | 4 | APM 서버사이드 계측 |
| Backend | @elastic/elasticsearch | 8 | ES 클라이언트 |
| Data | Elasticsearch | 9.3+ | 검색 엔진 |
| Data | Kibana | 9.3+ | 시각화 / Agent Builder |
| Infra | Elastic Cloud (ECH) | - | 완전관리형 Elastic Stack |

---

## 데이터셋 구조

### 인덱스명: `enterprise-knowledge`

사내 헬프데스크·위키·HR 정책 등을 모사한 **한국어/영어 혼합 기업 지식 데이터**입니다. `seed-data.js`로 약 100,000건의 문서를 생성합니다.

#### 카테고리 분포 (100,000건 기준)

| 카테고리 | 비율 | 건수(예상) | 내용 |
|---|---|---|---|
| IT 헬프데스크 | 35% | ~35,000 | VPN 오류, 비밀번호 초기화, 소프트웨어 요청 티켓 |
| 기술 위키 | 25% | ~25,000 | AWS IAM, Kubernetes 배포 가이드, Elastic Stack 운영 |
| HR 정책 | 15% | ~15,000 | 연차·반차 규정, 성과 평가, OKR |
| 보안 | 10% | ~10,000 | 피싱 신고 절차, 데이터 분류 기준, 랜섬웨어 대응 |
| 온보딩 | 7% | ~7,000 | 신입 IT 환경 설정, 계정 신청 체크리스트 |
| 인시던트 | 5% | ~5,000 | 장애 보고서, 원인 분석, 재발 방지 |
| 사내 공지 | 3% | ~3,000 | 교육 프로그램, 복지포인트, 건강검진 |

#### 문서 구조 (예시)

```json
{
  "title":        "비밀번호 만료 - 초기화 방법 문의",
  "content":      "## 개요\n사내 계정 비밀번호 정책...",
  "content_text": "## 개요\n사내 계정 비밀번호 정책...",
  "author":       "김민준",
  "department":   "IT운영팀",
  "category":     "IT 헬프데스크",
  "status":       "published",
  "view_count":   1423,
  "is_resolved":  true,
  "created_at":   "2024-03-15T09:00:00.000Z",
  "updated_at":   "2024-11-20T14:30:00.000Z"
}
```

> **포인트**: `content`와 `content_text` 필드는 **동일한 본문 데이터**를 저장하지만 타입이 다릅니다 — `content`는 `semantic_text`(벡터 검색), `content_text`는 `text`(BM25 검색). 동일 데이터를 두 필드에 저장함으로써 Lexical·Vector·Hybrid 세 검색 방식이 **공정하게 같은 데이터를 대상으로** 결과를 반환합니다.

---

## 인덱스 매핑 상세

```json
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword", "ignore_above": 512 }
        }
      },
      "content": {
        "type": "semantic_text",
        "inference_id": ".jina-embeddings-v5-text-small"
      },
      "content_text": { "type": "text" },
      "author":       { "type": "keyword" },
      "department":   { "type": "keyword" },
      "category":     { "type": "keyword" },
      "status":       { "type": "keyword" },
      "view_count":   { "type": "integer" },
      "is_resolved":  { "type": "boolean" },
      "created_at":   { "type": "date" },
      "updated_at":   { "type": "date" }
    }
  },
  "settings": {
    "number_of_shards":   1,
    "number_of_replicas": 1,
    "refresh_interval":   "30s"
  }
}
```

### 핵심 필드 해설

#### `title` — `text` + `keyword` 멀티 필드

```
"title": { "type": "text", "fields": { "keyword": { "type": "keyword" } } }
```

- **`text` 타입**: 분석기(Analyzer)를 통해 토큰화됩니다. BM25 키워드 검색 및 하이라이팅 대상.
- **`title.keyword` 서브 필드**: 분석 없이 원문 그대로 저장합니다. `collapse` (중복 제거), `terms` 집계에 사용됩니다.

`collapse: { field: "title.keyword" }` 적용 이유: 동일 제목의 문서가 반복 색인된 경우 결과에서 중복을 제거하기 위함입니다.

#### `content` — `semantic_text` (벡터 검색 핵심)

```
"content": { "type": "semantic_text", "inference_id": ".jina-embeddings-v5-text-small" }
```

`semantic_text`는 Elasticsearch 8.11+에서 도입된 데이터 타입으로, **색인 시점에 자동으로 텍스트를 임베딩 벡터로 변환**합니다.

| 항목 | 내용 |
|---|---|
| Inference 모델 | `.jina-embeddings-v5-text-small` (Elastic Cloud 내장) |
| 동작 방식 | 문서 색인 시 Inference API를 호출 → 벡터 자동 생성 후 저장 |
| 검색 쿼리 | `semantic` 쿼리 사용 (질의어도 자동 임베딩 후 kNN 계산) |
| 장점 | 개발자가 별도 임베딩 파이프라인을 구현하지 않아도 됨 |
| 주의 | 색인 속도가 `text` 타입보다 느림 (Inference API 호출 비용) |

내부적으로 ES는 다음과 같은 구조로 데이터를 저장합니다:

```
content (semantic_text)
  └── chunks[]          # 긴 텍스트는 청크로 분할
        ├── text        # 원문 청크
        └── inference   # 해당 청크의 임베딩 벡터
```

#### `content_text` — `text` (BM25 전용)

`content`와 동일한 본문을 `text` 타입으로 저장합니다. Lexical 검색의 `multi_match` 쿼리와 하이라이팅의 대상이 됩니다. `semantic_text` 필드는 `highlight` API를 지원하지 않기 때문에 이 필드가 필요합니다.

#### `category` — `keyword` (집계용)

분석 없이 원문 그대로 저장. `terms` 집계로 카테고리별 문서 분포를 계산합니다:

```json
"aggs": {
  "categories": { "terms": { "field": "category.keyword", "size": 8 } }
}
```

---

## 검색 쿼리 상세 설명

### 1. Lexical Search (BM25 키워드 검색)

**파일**: `backend/src/index.js` — `searchType === 'lexical'`

```javascript
const queryDsl = {
  index: 'enterprise-knowledge',
  size: 10,
  collapse: { field: 'title.keyword' },           // ① 동일 제목 중복 제거
  query: {
    multi_match: {
      query,                                        // ② 사용자 입력 검색어
      fields: ['title^2', 'content_text'],          // ③ 제목에 2배 가중치
      fuzziness: 'AUTO',                            // ④ 오타 허용 (편집 거리 자동 계산)
      type: 'best_fields',                          // ⑤ 가장 높은 스코어 필드 기준
    },
  },
  highlight: {
    pre_tags: ['<em>'], post_tags: ['</em>'],
    fields: {
      title:        { number_of_fragments: 0 },     // ⑥ 제목 전체 하이라이트
      content_text: { number_of_fragments: 2, fragment_size: 150 },
    },
  },
  aggs: {
    categories: { terms: { field: 'category.keyword', size: 8 } },  // ⑦ 카테고리 분포
  },
};
```

| 번호 | 옵션 | 의미 |
|---|---|---|
| ① | `collapse` | `title.keyword` 기준 중복 문서 접기. 100k건 중 60개의 고유 제목만 노출 |
| ② | `query` | 사용자 입력 그대로 전달 (서버에서 별도 전처리 없음) |
| ③ | `title^2` | BM25 스코어 계산 시 `title` 필드 점수에 2배 부스팅 |
| ④ | `fuzziness: AUTO` | 1~5자→fuzz=0, 6~8자→fuzz=1, 9자+→fuzz=2. 오타 문서도 검색 |
| ⑤ | `best_fields` | 여러 필드 중 가장 높은 BM25 스코어를 문서 스코어로 사용 |
| ⑥ | `number_of_fragments: 0` | 제목은 분절 없이 전체를 하이라이팅 |
| ⑦ | `aggs` | 결과 집합의 카테고리 분포 → UI 사이드바에 미니 바 차트로 표시 |

**BM25 스코어 계산 원리 (팀장급 참고)**:

$$\text{score}(d, q) = \sum_{t \in q} \text{IDF}(t) \cdot \frac{tf(t,d) \cdot (k_1 + 1)}{tf(t,d) + k_1 \cdot (1 - b + b \cdot \frac{|d|}{\text{avgdl}})}$$

- **IDF**: 희귀한 단어일수록 높은 가중치 (자주 나오는 단어는 낮은 점수)
- **TF**: 문서 내 용어 빈도 (많이 나올수록 높은 점수, 단 수확 체감)
- **Field length normalization**: 짧은 문서에서 매칭 시 점수 보정

**유리한 쿼리**: "비밀번호 만료", "연차 신청" — 정확한 키워드가 문서에 그대로 포함된 경우

---

### 2. Vector Search (Semantic 의미론적 검색)

**파일**: `backend/src/index.js` — `searchType === 'vector'`

```javascript
const queryDsl = {
  index: 'enterprise-knowledge',
  size: 10,
  collapse: { field: 'title.keyword' },
  query: {
    semantic: {
      field: 'content',   // semantic_text 필드 지정
      query,              // 질의어 → 자동으로 임베딩 벡터 변환 후 kNN 검색
    },
  },
  aggs: {
    categories: { terms: { field: 'category.keyword', size: 8 } },
  },
};
```

**`semantic` 쿼리 동작 순서**:

```
1. 사용자 입력: "계정 보안을 강화하고 싶어요"
        ↓
2. Inference API: 텍스트 → 벡터 변환
   [0.12, -0.34, 0.87, ..., 0.05]  (384차원)
        ↓
3. kNN 검색: 코사인 유사도로 가장 가까운 문서 벡터 탐색
        ↓
4. 결과: "MFA 설정 가이드", "비밀번호 복잡성 정책" 등
   (키워드가 다르더라도 의미가 유사한 문서 반환)
```

**BM25와의 차이**:

| 항목 | BM25 (Lexical) | Semantic (Vector) |
|---|---|---|
| 매칭 기준 | 정확한 단어 일치 | 의미적 유사도 |
| "보안 강화" 검색 시 | "보안 강화" 단어 포함 문서만 | "MFA", "2FA", "접근 제어" 등 관련 개념 문서도 |
| 오타 처리 | fuzziness 설정 필요 | 자동으로 허용 (벡터 공간에서 근접) |
| 하이라이팅 | 지원 | 미지원 (semantic_text 제약) |
| 응답 속도 | 빠름 | 상대적으로 느림 (임베딩 계산) |

**유리한 쿼리**: "계정 보안을 강화하고 싶어요" — 질의어에 있는 단어("보안 강화")가 문서에 직접 없어도 유사한 개념("MFA", "비밀번호 정책")을 찾음

---

### 3. Hybrid Search (FORK + FUSE + RERANK)

**파일**: `backend/src/index.js` — `searchType === 'hybrid'` (ES|QL 사용)

```sql
FROM enterprise-knowledge METADATA _id, _index, _score
| FORK
    (WHERE MATCH(title, "신입사원이 첫날 해야 할 일"))          -- BM25: 제목 키워드
    (WHERE MATCH(content_text, "신입사원이 첫날 해야 할 일"))   -- BM25: 본문 키워드
    (WHERE MATCH(content, "신입사원이 첫날 해야 할 일"))        -- Semantic: 의미론적
| FUSE
| RERANK "신입사원이 첫날 해야 할 일" ON content_text
  WITH {"inference_id": "my-jina-reranker"}
| SORT _score DESC
| LIMIT 10
| KEEP _score, title, content_text, category, department, author, status, created_at
```

#### FORK — 병렬 다중 검색

```
FORK
  (branch 1) → BM25 on title        : "신입사원" 단어 포함 제목 우선
  (branch 2) → BM25 on content_text : "첫날", "해야 할 일" 본문 매칭
  (branch 3) → Semantic on content  : "온보딩", "IT 환경 설정" 등 의미 유사 문서
```

세 브랜치가 **병렬**로 독립 실행됩니다. 각 브랜치의 결과는 서로 다른 문서 집합을 반환할 수 있습니다.

#### FUSE — Reciprocal Rank Fusion (RRF)

FORK의 세 결과를 **RRF 알고리즘**으로 병합합니다.

$$\text{RRF\_score}(d) = \sum_{i=1}^{3} \frac{1}{k + \text{rank}_i(d)}$$

- $k = 60$ (기본값, 순위 차이 평활화 상수)
- 한 브랜치에서만 등장한 문서보다 **여러 브랜치에 공통 등장**한 문서가 높은 RRF 점수를 받음
- 각 브랜치의 원시 스코어 크기와 무관하게 **순위(rank)** 기반 병합이므로 스코어 정규화 불필요

#### RERANK — Cross-Encoder 재정렬

```json
RERANK "query" ON content_text WITH {"inference_id": "my-jina-reranker"}
```

- **Bi-Encoder(벡터 검색)와의 차이**: Bi-Encoder는 질의와 문서를 각각 독립 인코딩하여 코사인 유사도를 계산합니다. Cross-Encoder는 (질의, 문서) 쌍을 함께 입력하여 더 정교한 관련도 점수를 산출합니다.
- `my-jina-reranker`: Jina Reranker 모델 (Kibana > Machine Learning > Trained Models에서 사전 배포 필요)
- RERANK는 RRF 결과를 받아 최종 순위를 재조정합니다 (계산 비용이 크므로 Top-N에만 적용)

**파이프라인 흐름 요약**:

```
FORK (3개 브랜치 병렬)
  → 합산 후보 문서: 최대 30건 (각 브랜치 Top-10 가정)
  → FUSE (RRF): 순위 기반 점수 통합 → Top-10 선별
  → RERANK (Cross-Encoder): 최종 관련도로 재정렬
  → SORT + LIMIT: 최종 10건 반환
```

**유리한 쿼리**: "신입사원이 첫날 해야 할 일 목록" — 키워드 매칭(FORK 1,2)과 의미론적 탐색(FORK 3)이 서로를 보완하고, RERANK가 최적 순서로 정렬

> **주의**: ES|QL은 `highlight`, `aggregations`를 지원하지 않습니다. Hybrid 모드에서는 하이라이팅과 카테고리 집계가 표시되지 않습니다.

---

## Observability 계측 구조

### 분산 추적 (Distributed Tracing)

```
Browser (APM RUM)                    Node.js (APM Agent)
─────────────────                    ───────────────────
transaction: "Search:hybrid"
  span: XHR POST /api/search
    header: traceparent: 00-{trace-id}-{span-id}-01
                                     ↓ trace-id 연결
                                     transaction: POST /api/search
                                       span: search:hybrid (elasticsearch)
                                         ES 쿼리 실행
```

`traceparent` 헤더(W3C Trace Context)로 **브라우저 → 백엔드** 트랜잭션이 하나의 trace로 연결됩니다. Kibana APM의 Trace 뷰에서 전체 요청 경로를 waterfall로 확인할 수 있습니다.

### 프론트엔드 계측 (`frontend/src/main.jsx`)

```javascript
initApm({
  serviceName: 'search-demo-frontend',
  serverUrl:   process.env.VITE_APM_SERVER_URL,   // APM Server 직접 전송
  active:      !!process.env.VITE_APM_SERVER_URL,
  distributedTracingOrigins: ['http://localhost:3000'],  // traceparent 헤더 주입 대상
});
```

수집 데이터:
- **Page Load 트랜잭션**: 페이지 로드 시간, 리소스 타이밍
- **User Interaction 트랜잭션**: `Search:lexical`, `Search:vector`, `Search:hybrid`, `Search:compare`, `Chat:send`
- **XHR/Fetch 스팬**: 백엔드 API 호출 타이밍
- **JavaScript 에러**: `apm.captureError()` 또는 unhandledrejection 자동 캡처

### 백엔드 계측 (`backend/instrument.mjs`, `backend/src/index.js`)

**ESM 환경에서의 APM 초기화**:

```javascript
// instrument.mjs — node --import 로 메인 모듈보다 먼저 실행
import apm from 'elastic-apm-node';
apm.start({
  serviceName:              'search-demo-backend',
  usePathAsTransactionName: true,   // /api/search/:id 형태로 트랜잭션명 정규화
  captureBody:              'errors',
  transactionSampleRate:    1.0,    // 100% 샘플링
});
```

> **ESM 주의사항**: ESM(`"type": "module"`)에서는 `import` 문이 호이스팅됩니다. `index.js` 내에서 `apm.start()`를 호출하면 `express`, `http` 모듈이 이미 로드된 상태라 HTTP 자동 계측이 동작하지 않습니다. `--import ./instrument.mjs` 플래그로 APM을 선행 실행해야 합니다.

수집 데이터:
- **HTTP 트랜잭션**: Express 라우트별 응답 시간, 상태 코드 자동 수집
- **ES 쿼리 스팬**: `apm.startSpan('search:hybrid', 'elasticsearch')` — 쿼리 실행 시간
- **커스텀 레이블**: `apm.setLabel('search.type', searchType)`, `apm.setLabel('search.query', query)`
- **커스텀 컨텍스트**: `apm.setCustomContext({ search_query_dsl: fullQueryJson })` — 1024자 제한 없는 전체 쿼리 저장

Kibana APM 확인 경로:
- `APM > Services > search-demo-backend > Transactions` — 검색 유형별 응답 시간 비교
- `APM > Services > search-demo-backend > Transactions > [선택] > Trace` — ES 쿼리 스팬 상세
- `APM > Services > search-demo-backend > Transactions > [선택] > Metadata > Custom` — 전체 ES 쿼리 DSL 확인

---

## Agent Builder 연동

`POST /api/chat` 엔드포인트가 Kibana Agent Builder의 `search-demo` 에이전트를 호출합니다.

```
사용자 메시지
     ↓
Node.js Backend
     ↓  POST {KIBANA_URL}/api/agent_builder/converse
Kibana Agent Builder ("search-demo" agent)
     ↓  내부적으로 enterprise-knowledge 인덱스 검색
     ↓  LLM으로 답변 생성
     ↓  SSE 또는 동기 응답 반환
Backend → SSE 스트림으로 프론트엔드 중계
     ↓
사용자 화면 (타이핑 효과로 실시간 표시)
```

**Kibana 설정 필요**: Kibana > Observability > AI Assistant / Agent Builder에서 `search-demo`라는 이름의 에이전트를 생성하고, `enterprise-knowledge` 인덱스를 데이터 소스로 연결해야 합니다.

---

## 사전 요구사항

### 필수

- **Node.js** ≥ 20 (`node --version`으로 확인)
- **npm** ≥ 10
- **Elastic Cloud 배포** (Elasticsearch + Kibana) — Elastic Stack 8.11 이상 권장, 9.x 최적화
- **ES|QL FORK/FUSE/RERANK** 지원: Elasticsearch 9.0+
- **Inference API**: `.jina-embeddings-v5-text-small` 모델 활성화 (Elastic Cloud 내장)
- **Reranker 모델**: `my-jina-reranker` — Kibana > ML > Trained Models에서 배포 필요

### 선택

- **Agent Builder 에이전트**: `search-demo` 에이전트 사전 생성 (AI 채팅 기능)

---

## 설치 및 실행

### 1. 저장소 클론

```bash
git clone https://github.com/<your-org>/search-demo.git
cd search-demo
```

### 2. 환경변수 설정

루트 디렉터리에 `.env` 파일을 생성합니다 (아래 [환경변수 설정](#환경변수-설정) 섹션 참조):

```bash
cp .env.example .env   # .env.example이 있는 경우
# 또는 직접 생성
vi .env
```

### 3. 의존성 설치

```bash
# 백엔드
cd backend && npm install

# 프론트엔드
cd ../frontend && npm install
cd ..
```

### 4. 실행

#### 방법 A: 스크립트로 백그라운드 실행 (권장)

```bash
chmod +x start.sh stop.sh

# 백엔드 + 프론트엔드 동시 시작
./start.sh

# 개별 시작
./start.sh backend
./start.sh frontend

# 중지
./stop.sh
```

로그 확인:
```bash
tail -f .logs/backend.log
tail -f .logs/frontend.log
```

#### 방법 B: 터미널 2개로 개발 모드 실행

```bash
# 터미널 1: 백엔드 (파일 변경 시 자동 재시작)
cd backend
npm run dev

# 터미널 2: 프론트엔드 (HMR)
cd frontend
npm run dev
```

### 5. 접속 확인

| 서비스 | URL |
|---|---|
| 프론트엔드 | http://localhost:5173 |
| 백엔드 Health | http://localhost:3000/api/health |

---

## 환경변수 설정

`.env` 파일 (프로젝트 루트)에 아래 값을 설정합니다. 이 파일은 `.gitignore`에 포함되어 있으므로 **절대 커밋하지 마세요**.

```bash
# =============================================================================
# Elasticsearch / Elastic Cloud
# =============================================================================

# Cloud ID: Elastic Cloud Console > 배포 > Overview에서 복사
ES_CLOUD_ID=my-deployment:dXMtZWFzdC0xLmF3cy5mb3VuZC5pbyQ...

# API Key: Kibana > Stack Management > API Keys > Create API Key
# 권한: 모든 인덱스 read/write, index 관리 권한
ES_API_KEY=VuaCfGcBCdbkQm...

# =============================================================================
# Kibana
# =============================================================================

# Kibana URL: Cloud Console에서 Kibana 엔드포인트 확인
KIBANA_URL=https://my-deployment.kb.us-east-1.aws.elastic-cloud.com

# AI 채팅 전용 API Key (선택: 없으면 ES_API_KEY 사용)
# 권한: enterprise-knowledge 인덱스 read + Kibana AI 기능
KIBANA_CHAT_API_KEY=

# =============================================================================
# APM Server (백엔드 Node.js 계측)
# =============================================================================

# APM Server URL: Kibana > Observability > APM > Add data > APM Server URL
APM_SERVER_URL=https://xxxx.apm.us-east-1.aws.elastic-cloud.com:443

# APM Secret Token: APM Integration 설정에서 확인
APM_SECRET_TOKEN=your-secret-token

# APM 서비스명 (Kibana APM UI에 표시)
APM_SERVICE_NAME=search-demo-backend

# =============================================================================
# APM RUM (프론트엔드 브라우저 계측)
# VITE_ 접두사 필수 (Vite가 빌드 시 인라인 치환)
# =============================================================================

VITE_APM_SERVER_URL=https://xxxx.apm.us-east-1.aws.elastic-cloud.com:443
VITE_APM_SERVICE_NAME=search-demo-frontend

# =============================================================================
# 애플리케이션
# =============================================================================

# 프론트엔드에서 백엔드 API 호출 시 사용
VITE_API_URL=http://localhost:3000

PORT=3000
NODE_ENV=development
```

### API Key 생성 방법

```
Kibana > Stack Management > Security > API Keys > Create API Key

권장 권한 (최소 권한 원칙):
  cluster:   ["monitor"]
  index:     [{ names: ["enterprise-knowledge"], privileges: ["read", "write", "create_index", "manage"] }]
  kibana:    [{ spaces: ["*"], base: ["all"] }]
```

---

## 데이터 시딩

`enterprise-knowledge` 인덱스 생성 및 100,000건 데이터 색인:

```bash
cd backend

# 기본 실행 (100,000건)
node seed-data.js

# 건수 지정
node seed-data.js --count=10000

# 인덱스 재생성 (기존 데이터 삭제 후 재색인)
node seed-data.js --force
node seed-data.js --force --count=5000
```

> **소요 시간**: semantic_text 필드의 임베딩 생성 때문에 100,000건 기준 약 **20~40분** 소요됩니다 (클러스터 사양 및 Inference API 처리 속도에 따라 다름). 청크 크기는 500건으로 설정되어 있습니다.

**색인 진행 상황 출력 예시**:
```
=================================================================
 enterprise-knowledge 인덱스 시딩 (사내 헬프데스크/위키)
  총 문서 수: 100,000건  |  청크: 500건
=================================================================

✓ ES 연결: v9.3.1 (my-cluster)
✓ 인덱스 생성: enterprise-knowledge
  content → semantic_text (.jina-embeddings-v5-text-small)

  색인 시작...

  진행:  35,500 / 100,000  [ 35.5%]  42 docs/s  경과: 845.2s  ETA: 1531s
```

---

## Elasticsearch 사전 설정

시딩 전 아래 설정이 완료되어 있어야 합니다.

### 1. Inference API 모델 확인

Kibana Dev Tools에서 내장 임베딩 모델 확인:

```http
GET _inference/text_embedding/.jina-embeddings-v5-text-small
```

모델이 없으면 Elastic Cloud 내장 모델 목록에서 활성화하거나, 다른 `inference_id`로 `seed-data.js`의 매핑을 수정하세요.

### 2. Reranker 모델 배포 (Hybrid 검색)

```
Kibana > Machine Learning > Trained Models > Add trained model
모델 검색: "jina-reranker" 또는 "cross-encoder"
배포 ID: my-jina-reranker (seed-data.js 및 index.js와 일치)
```

배포 후 확인:
```http
POST _inference/rerank/my-jina-reranker
{
  "input": ["test query"],
  "query": "test"
}
```

### 3. 인덱스 상태 확인

```http
GET enterprise-knowledge/_count
GET enterprise-knowledge/_mapping
GET enterprise-knowledge/_settings
```

---

## APM RUM CORS 설정

브라우저(RUM Agent)가 APM Server로 직접 데이터를 전송하려면 APM Server에서 CORS를 허용해야 합니다.

```
Kibana > Fleet > Agent Policies > (APM Integration 선택) > Edit Integration

Real User Monitoring (RUM) 섹션:
  Enable RUM: ON
  Allow Origins: ["http://localhost:5173"]
```

설정 저장 후 브라우저에서 Network 탭 > `intake/v2/rum/events` 요청이 200 응답을 받는지 확인합니다.

---

## UI 기능 안내

### 검색 모드

| 모드 | 색상 | 설명 |
|---|---|---|
| Lexical | 초록 | BM25 `multi_match` + `fuzziness: AUTO` + 하이라이팅 |
| Vector | 보라 | `semantic` 쿼리 (kNN 의미론적 검색) |
| Hybrid | 파랑 | ES|QL FORK + FUSE(RRF) + RERANK |
| 3-way 비교 | 주황 | 세 방식을 동시 실행, 3열 나란히 비교 |

### 3-way 비교 모드 공통 문서 표시

| 표시 | 의미 |
|---|---|
| 파란 배경 + 파란 별 | 3가지 검색 방식 모두에 등장한 문서 (높은 신뢰도) |
| 노란 배경 + 노란 별 | 2가지 방식에 등장한 문서 |
| 흰 배경 | 해당 방식에서만 등장한 문서 |

### 추천 검색어 (검색 방식 차이 시연용)

| 쿼리 | 유리한 방식 | 이유 |
|---|---|---|
| 비밀번호가 만료되어 로그인이 안 돼요 | Lexical | "만료", "비밀번호" 키워드가 문서 제목과 정확히 일치 |
| 계정 보안을 강화하고 싶어요 | Vector | "MFA", "비밀번호 정책" 등 유사 개념 문서를 의미론적으로 탐색 |
| 피싱 의심 메일을 받았을 때 대처 방법 | Lexical | "피싱", "이메일", "신고" 키워드 정확 매칭 |
| 신입사원이 첫날 해야 할 일 목록 | Hybrid | 키워드+시맨틱 FORK → RRF → RERANK가 잡음 없이 온보딩 문서 정확 반환 |
| 연차 남은 일수 확인하고 반차 신청하는 방법 | Lexical | "연차", "반차" 두 키워드가 정확히 매칭되는 HR 문서 동시 반환 |
| 보안 사고 발생 시 신고 절차와 예방 교육 | 3-way 비교 추천 | 각 방식이 서로 다른 관련 보안 문서를 반환해 차이가 뚜렷함 |

### APM 에러 시뮬레이션 (헤더 우상단 버튼)

| 시나리오 | 동작 | Kibana 확인 위치 |
|---|---|---|
| JS 런타임 에러 | `TypeError` → `apm.captureError()` | APM > search-demo-frontend > Errors |
| Unhandled Promise Rejection | `Promise.reject()` uncaught → RUM 자동 캡처 | APM > search-demo-frontend > Errors |
| 커스텀 비즈니스 에러 | `SearchServiceError` + custom context | APM > search-demo-frontend > Errors |

---

## 트러블슈팅

### APM RUM: "serverUrl is missing"

`.env` 파일의 `VITE_APM_SERVER_URL`이 설정되어 있는지 확인합니다. `vite.config.js`가 `envDir: resolve(__dirname, '..')`로 상위 디렉터리의 `.env`를 읽도록 설정되어 있습니다.

```bash
# frontend/ 디렉터리가 아닌 프로젝트 루트의 .env 수정
vi .env   # (search-demo/.env)
```

### Hybrid 검색 오류: "RERANK inference endpoint not found"

`my-jina-reranker` 모델이 배포되지 않았습니다. [Elasticsearch 사전 설정](#elasticsearch-사전-설정) > Reranker 모델 배포를 완료하세요.

### 검색 결과 중복

인덱스에 동일 제목 문서가 다수 존재하면 `collapse: { field: "title.keyword" }`가 적용되지 않은 것입니다. `seed-data.js --force`로 인덱스를 재생성하세요.

### 백엔드 기동 시 ES 연결 실패

```bash
curl http://localhost:3000/api/health
# { "status": "error", "message": "..." }
```

`.env`의 `ES_CLOUD_ID`와 `ES_API_KEY`가 올바른지, 해당 API Key에 `enterprise-knowledge` 인덱스 접근 권한이 있는지 확인합니다.

### AI 채팅: "KIBANA_URL이 설정되지 않았습니다"

`.env`에 `KIBANA_URL`을 직접 입력합니다. Cloud ID 자동 감지가 실패하는 경우입니다.

```bash
KIBANA_URL=https://my-deployment.kb.us-east-1.aws.elastic-cloud.com
```

---

## 프로젝트 구조

```
search-demo/
├── .env                          # 환경변수 (gitignore — 커밋 금지)
├── .env.example                  # 환경변수 템플릿
├── start.sh                      # 백그라운드 시작 스크립트
├── stop.sh                       # 중지 스크립트
├── backend/
│   ├── instrument.mjs            # APM 사전 초기화 (ESM --import 용)
│   ├── seed-data.js              # 인덱스 생성 + 10만건 시딩
│   ├── package.json
│   └── src/
│       └── index.js             # Express 서버 (search / chat / health API)
└── frontend/
    ├── vite.config.js            # envDir: 상위 .env 읽기 설정
    ├── package.json
    └── src/
        ├── main.jsx              # APM RUM 초기화
        ├── App.jsx               # withTransaction 래핑
        ├── api/
        │   └── search.js        # Axios API 클라이언트
        └── pages/
            └── SearchPage.jsx   # 검색 UI 전체 (ResultCard, CompareView 등)
```

---

## 라이선스

MIT License — 사내 PoV 및 교육 목적으로 자유롭게 활용 가능합니다.
