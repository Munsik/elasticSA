// =============================================================================
// APM은 --import ./instrument.mjs 플래그로 이미 시작됨.
// instrument.mjs에서 dotenv 로딩 + apm.start() 완료 후 이 모듈이 로드된다.
// 여기서는 이미 초기화된 apm 에이전트를 import하여 span/error 계측에 사용한다.
// =============================================================================
import apm from 'elastic-apm-node';

// =============================================================================
// 나머지 모듈 import
// =============================================================================
import express  from 'express';
import cors     from 'cors';
import { Client } from '@elastic/elasticsearch';

const app  = express();
const PORT = process.env.PORT || 3000;

// 프론트엔드(http://localhost:5173)로부터의 요청만 허용
// allowedHeaders에 W3C Trace Context 헤더(traceparent, tracestate)와
// Elastic 레거시 헤더(elastic-apm-traceparent)를 명시적으로 포함해야
// 브라우저 CORS preflight를 통과하여 RUM → Backend 분산 추적이 연결된다.
app.use(cors({
  origin:         'http://localhost:5173',
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'traceparent',               // W3C Trace Context — RUM 에이전트가 추가
    'tracestate',                // W3C Trace Context — RUM 에이전트가 추가
    'elastic-apm-traceparent',   // Elastic 레거시 형식
  ],
  credentials: true,
}));

app.use(express.json());

// =============================================================================
// 4. Elasticsearch 클라이언트
// =============================================================================
const es = new Client({
  cloud: { id: process.env.ES_CLOUD_ID },
  auth:  { apiKey: process.env.ES_API_KEY },
});

// Kibana 베이스 URL (Cloud ID에서 추출 또는 직접 지정)
const KIBANA_URL = process.env.KIBANA_URL
  || (() => {
      try {
        const b64 = process.env.ES_CLOUD_ID?.split(':')[1];
        if (!b64) return null;
        const decoded  = Buffer.from(b64, 'base64').toString('utf-8');
        // 디코딩 형식: "host:port$es_uuid$kibana_uuid"
        const [hostPort, , kibanaUuid] = decoded.split('$');
        return `https://${kibanaUuid}.${hostPort}`;
      } catch {
        return null;
      }
    })();

// =============================================================================
// 5. 유틸 함수
// =============================================================================

/**
 * Kibana Agent Builder 전용 헤더
 */
function kibanaHeaders() {
  const apiKey = process.env.KIBANA_CHAT_API_KEY?.trim() || process.env.ES_API_KEY;
  return {
    'Content-Type': 'application/json',
    'kbn-xsrf':     'true',
    Authorization:  `ApiKey ${apiKey}`,
  };
}

/**
 * ES|QL 문자열 리터럴 이스케이프
 */
function esqlEscape(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g,  '\\"');
}

/**
 * ES|QL 응답(컬럼/값 테이블 형식)을 /api/search 표준 hits 배열로 변환
 */
function esqlToHits(esqlResult) {
  const colNames = esqlResult.columns.map((c) => c.name);
  const seen  = new Set();
  const hits  = [];

  for (const row of esqlResult.values) {
    const hit = {};
    colNames.forEach((name, i) => {
      const key = name === '_score' ? 'score' : name === 'content_text' ? 'content' : name;
      hit[key] = row[i];
    });
    hit.highlight = {};

    if (!seen.has(hit.title)) {
      seen.add(hit.title);
      hits.push(hit);
    }
  }
  return hits;
}

// =============================================================================
// 6. Health Check
// =============================================================================
app.get('/api/health', async (req, res) => {
  try {
    const info = await es.info();
    res.json({
      status: 'ok',
      elasticsearch: { version: info.version.number, cluster: info.cluster_name },
      kibana_url:    KIBANA_URL || '(not configured)',
      apm_active:    apm.isStarted(),
    });
  } catch (err) {
    apm.captureError(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// =============================================================================
// 7. /api/search  — Lexical / Vector / Hybrid 검색
// =============================================================================
app.post('/api/search', async (req, res) => {
  const {
    query,
    searchType = 'hybrid',
    index      = 'search-demo',
    size       = 10,
  } = req.body;

  if (!query?.trim()) {
    return res.status(400).json({ error: '검색어(query)는 필수입니다.' });
  }

  const span = apm.startSpan(`search:${searchType}`, 'elasticsearch');
  apm.setLabel('search.type', searchType);
  apm.setLabel('search.query', query.slice(0, 100));

  try {

    // ------------------------------------------------------------------
    // 7-A. Lexical Search (BM25 multi_match — Query DSL)
    // ------------------------------------------------------------------
    if (searchType === 'lexical') {
      const queryDsl = {
        index,
        size,
        collapse: { field: 'title.keyword' },
        query: {
          multi_match: {
            query,
            fields:    ['title^2', 'content_text'],
            fuzziness: 'AUTO',
            type:      'best_fields',
          },
        },
        highlight: {
          pre_tags:  ['<em>'],
          post_tags: ['</em>'],
          fields: {
            title:        { number_of_fragments: 0 },
            content_text: { number_of_fragments: 2, fragment_size: 150 },
          },
        },
        aggs: {
          categories: { terms: { field: 'category.keyword', size: 8 } },
        },
      };

      apm.setCustomContext({ search_query_dsl: JSON.stringify(queryDsl, null, 2) });

      const result = await es.search(queryDsl);

      return res.json({
        took:  result.took,
        total: result.hits.total?.value ?? result.hits.total,
        hits:  result.hits.hits.map((h) => ({
          id:        h._id,
          score:     h._score,
          highlight: h.highlight ?? {},
          ...h._source,
        })),
        facets: {
          categories: result.aggregations?.categories?.buckets?.map((b) => ({
            key:   b.key,
            count: b.doc_count,
          })) ?? [],
        },
      });
    }

    // ------------------------------------------------------------------
    // 7-B. Vector Search (Semantic — semantic_text 필드 / Jina v5 embedding)
    // ------------------------------------------------------------------
    if (searchType === 'vector') {
      const queryDsl = {
        index,
        size,
        collapse: { field: 'title.keyword' },
        query: {
          semantic: {
            field: 'content',
            query,
          },
        },
        aggs: {
          categories: { terms: { field: 'category.keyword', size: 8 } },
        },
      };

      apm.setCustomContext({ search_query_dsl: JSON.stringify(queryDsl, null, 2) });

      const result = await es.search(queryDsl);

      return res.json({
        took:  result.took,
        total: result.hits.total?.value ?? result.hits.total,
        hits:  result.hits.hits.map((h) => ({
          id:        h._id,
          score:     h._score,
          highlight: h.highlight ?? {},
          ...h._source,
        })),
        facets: {
          categories: result.aggregations?.categories?.buckets?.map((b) => ({
            key:   b.key,
            count: b.doc_count,
          })) ?? [],
        },
      });
    }

    // ------------------------------------------------------------------
    // 7-C. Hybrid Search — ES|QL FORK / FUSE / RERANK (Jina v5 reranker)
    //
    //  파이프라인 구조:
    //    1) FROM ... METADATA _id, _index, _score
    //    2) FORK — 검색 방식별 독립 실행
    //         branch 1: BM25 on title       (제목 키워드 매칭)
    //         branch 2: BM25 on content_text (본문 키워드 매칭)
    //         branch 3: Semantic on content  (Jina v5 의미론적 매칭)
    //    3) FUSE — RRF(Reciprocal Rank Fusion)으로 세 브랜치 결과 병합
    //    4) RERANK — Jina v5 cross-encoder로 최종 재정렬
    //    5) SORT _score DESC | LIMIT size | KEEP 필요 필드
    // ------------------------------------------------------------------
    const safeQuery = esqlEscape(query);

    const esqlQuery = [
      `FROM ${index} METADATA _id, _index, _score`,
      `| FORK`,
      `    (WHERE MATCH(title, "${safeQuery}"))`,
      `    (WHERE MATCH(content_text, "${safeQuery}"))`,
      `    (WHERE MATCH(content, "${safeQuery}"))`,
      `| FUSE`,
      `| RERANK "${safeQuery}" ON content_text WITH {"inference_id": "my-jina-reranker"}`,
      `| SORT _score DESC`,
      `| LIMIT ${size}`,
      `| KEEP _score, title, content_text, category, department, author, status, created_at`,
    ].join('\n');

    apm.setCustomContext({ search_esql_query: esqlQuery });

    const result = await es.esql.query({ query: esqlQuery });

    return res.json({
      took:  result.took ?? 0,
      total: result.values?.length ?? 0,
      hits:  esqlToHits(result),
    });

  } catch (err) {
    apm.captureError(err);
    res.status(500).json({ error: err.message });
  } finally {
    span?.end();
  }
});

// =============================================================================
// 8. /api/chat  — Elastic Agent Builder Converse API
// =============================================================================
const AGENT_ID      = 'search-demo';
const CONVERSE_PATH = '/api/agent_builder/converse';

app.post('/api/chat', async (req, res) => {
  const { input, conversation_id } = req.body;

  if (!input?.trim()) {
    return res.status(400).json({ error: 'input은 필수입니다.' });
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const span = apm.startSpan('chat:agent-builder-converse', 'external');
  apm.setLabel('chat.agent_id',       AGENT_ID);
  apm.setLabel('chat.input_length',   input.length);
  if (conversation_id) apm.setLabel('chat.conversation_id', conversation_id);

  try {
    if (!KIBANA_URL) {
      throw new Error('KIBANA_URL이 설정되지 않았습니다. .env를 확인하세요.');
    }

    const requestBody = {
      input,
      agent_id: AGENT_ID,
      ...(conversation_id && { conversation_id }),
    };

    const agentResponse = await fetch(
      `${KIBANA_URL}${CONVERSE_PATH}`,
      {
        method:  'POST',
        headers: kibanaHeaders(),
        body:    JSON.stringify(requestBody),
      }
    );

    if (!agentResponse.ok) {
      const errText = await agentResponse.text();
      throw new Error(`Agent Builder 오류 (${agentResponse.status}): ${errText}`);
    }

    const contentType = agentResponse.headers.get('content-type') || '';

    // 8-A. converse-async: SSE 스트림 직접 중계
    if (contentType.includes('text/event-stream')) {
      const reader  = agentResponse.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';
      let   finalConversationId = conversation_id || null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const chunk = JSON.parse(raw);
            if (chunk.response?.message) {
              sendEvent('chunk', { text: chunk.response.message });
            }
            if (chunk.conversation_id) {
              finalConversationId = chunk.conversation_id;
            }
            if (chunk.done === true || chunk.finished === true) {
              sendEvent('done', {
                conversation_id: finalConversationId,
                steps: chunk.steps ?? [],
              });
            }
          } catch {
            // 비 JSON 라인 무시
          }
        }
      }

    // 8-B. converse (동기): 응답을 SSE 단일 이벤트로 래핑
    } else {
      const body    = await agentResponse.json();
      const message = body.response?.message ?? '';
      const CHUNK   = 30;

      for (let i = 0; i < message.length; i += CHUNK) {
        sendEvent('chunk', { text: message.slice(i, i + CHUNK) });
        await new Promise((r) => setTimeout(r, 10));
      }

      sendEvent('done', {
        conversation_id: body.conversation_id ?? null,
        steps:           body.steps           ?? [],
      });
    }

  } catch (err) {
    apm.captureError(err);
    sendEvent('error', { message: err.message });
  } finally {
    span?.end();
    res.end();
  }
});

// =============================================================================
// 9. /api/analytics/event  — 검색 행동 이벤트 수집 (자체 인덱스 방식)
//
// ※ Elastic Behavioral Analytics는 9.0에서 deprecated / Kibana UI 제거됨.
//    (Kibana 9.0 Breaking Changes 공식 확인)
//    대체 방식: ES 클라이언트로 전용 인덱스에 직접 저장 → Kibana Dashboard로 시각화
//
// 수집 이벤트:
//   - search : 검색 실행 시점 (쿼리, 검색 방식, 결과 수, 상위 문서 목록)
//   - click  : 검색 결과 문서 클릭 시점 (문서 ID, 검색어, 클릭 순위)
//
// 저장 인덱스: rws-search-events-YYYY-MM  (월별 자동 롤오버)
//   → Kibana > Stack Management > Data Views 에서 패턴 "rws-search-events-*" 등록
//   → 이후 Dashboard에서 아래 분석 가능:
//       · 인기 검색어 Top N (terms agg on search.query)
//       · Zero-result 쿼리 (filter: results.total_results == 0)
//       · 클릭률 CTR (search 이벤트 수 대비 click 이벤트 수)
//       · 검색 방식별 클릭 분포 (terms agg on search.search_type)
//       · 시간대별 검색량 추이 (date_histogram on @timestamp)
//
// .env 추가 항목 없음 — ES_CLOUD_ID / ES_API_KEY 기존 설정 그대로 사용
// =============================================================================

// 월별 롤오버 인덱스명 생성 헬퍼
function analyticsIndex() {
  const ym = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  return `rws-search-events-${ym}`;
}

// 인덱스 최초 생성 시 매핑 정의 (최초 1회만 실행됨)
async function ensureAnalyticsIndex(index) {
  const exists = await es.indices.exists({ index });
  if (exists) return;

  await es.indices.create({
    index,
    mappings: {
      properties: {
        '@timestamp':  { type: 'date' },
        event_type:    { type: 'keyword' },            // 'search' | 'click'
        session_id:    { type: 'keyword' },            // 탭 단위 세션 ID
        search: {
          properties: {
            query:        { type: 'text',
                            fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
            search_type:  { type: 'keyword' },         // 'lexical' | 'vector' | 'hybrid'
            total_results:{ type: 'integer' },
          },
        },
        document: {
          properties: {
            id:    { type: 'keyword' },
            index: { type: 'keyword' },
          },
        },
        click_rank: { type: 'integer' },               // 클릭된 문서의 검색 결과 순위 (1-based)
      },
    },
    settings: {
      number_of_shards:   1,
      number_of_replicas: 1,
    },
  });
}

app.post('/api/analytics/event', async (req, res) => {
  const { eventType, payload } = req.body;

  if (!['search', 'click'].includes(eventType)) {
    return res.status(400).json({ error: 'eventType은 "search" 또는 "click"이어야 합니다.' });
  }

  const span = apm.startSpan(`analytics:${eventType}`, 'elasticsearch');
  apm.setLabel('analytics.event_type', eventType);
  apm.setLabel('analytics.query',      payload?.search?.query?.slice(0, 100) ?? '');

  try {
    const index = analyticsIndex();

    // 인덱스 없으면 매핑과 함께 생성 (비동기, 실패해도 이벤트 저장 계속 시도)
    await ensureAnalyticsIndex(index).catch(() => {});

    // 플랫 구조로 정규화하여 저장 — Kibana 집계/필터 쿼리 용이성 우선
    const doc = {
      '@timestamp':   new Date().toISOString(),
      event_type:     eventType,
      session_id:     payload?.session?.id ?? null,

      // search 공통 필드
      'search.query':        payload?.search?.query        ?? null,
      'search.search_type':  payload?.search?.search_type  ?? null,
      'search.total_results':
        eventType === 'search'
          ? (payload?.search?.results?.total_results ?? 0)
          : null,

      // click 전용 필드
      'document.id':    eventType === 'click' ? (payload?.document?.id    ?? null) : null,
      'document.index': eventType === 'click' ? (payload?.document?.index ?? null) : null,
      click_rank:       eventType === 'click' ? (payload?.page?.current   ?? null) : null,
    };

    await es.index({ index, document: doc });

    res.json({ ok: true });

  } catch (err) {
    apm.captureError(err);
    // Analytics 실패는 검색 UX에 영향을 주면 안 되므로 200 반환
    res.json({ ok: false, error: err.message });
  } finally {
    span?.end();
  }
});

// =============================================================================
// 10. /api/seed  — 테스트 데이터 인덱싱
// =============================================================================
app.post('/api/seed', async (req, res) => {
  const { count = 50, index = 'search-demo' } = req.body;
  const span = apm.startSpan('seed:bulk-index', 'elasticsearch');

  try {
    const { faker } = await import('@faker-js/faker');

    const exists = await es.indices.exists({ index });
    if (!exists) {
      await es.indices.create({
        index,
        mappings: {
          properties: {
            title:      { type: 'text' },
            content:    { type: 'text' },
            tags:       { type: 'keyword' },
            category:   { type: 'keyword' },
            created_at: { type: 'date' },
          },
        },
      });
    }

    const docs = Array.from({ length: count }, () => ({
      title:      faker.lorem.sentence(),
      content:    faker.lorem.paragraphs(3),
      tags:       Array.from(
        { length: faker.number.int({ min: 1, max: 5 }) },
        () => faker.word.noun()
      ),
      category:   faker.helpers.arrayElement(['tech', 'business', 'science', 'culture', 'sports']),
      created_at: faker.date.past().toISOString(),
    }));

    const operations = docs.flatMap((doc) => [{ index: { _index: index } }, doc]);
    const bulkResult = await es.bulk({ refresh: true, operations });

    apm.setLabel('seed.count', count);
    res.json({
      indexed: count,
      errors:  bulkResult.errors,
      index,
    });

  } catch (err) {
    apm.captureError(err);
    res.status(500).json({ error: err.message });
  } finally {
    span?.end();
  }
});

// =============================================================================
// 11. 서버 시작
// =============================================================================
app.listen(PORT, () => {
  console.log(`\n🚀 Backend: http://localhost:${PORT}`);
  console.log(`   APM:     ${apm.isStarted() ? process.env.APM_SERVER_URL : '비활성화'}`);
  console.log(`   Kibana:  ${KIBANA_URL || '(KIBANA_URL 미설정 — Cloud ID 자동 감지 실패)'}`);
  console.log(`   Analytics Index: rws-search-events-YYYY-MM (월별 자동 생성)\n`);
});
