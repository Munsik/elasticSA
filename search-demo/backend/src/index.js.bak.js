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
// Cloud ID 형식: "name:base64" → base64 디코딩하면 호스트 정보가 나옴
const KIBANA_URL = process.env.KIBANA_URL
  || (() => {
      try {
        const b64 = process.env.ES_CLOUD_ID?.split(':')[1];
        if (!b64) return null;
        const decoded  = Buffer.from(b64, 'base64').toString('utf-8');
        // 디코딩 형식: "host:port$es_uuid$kibana_uuid"
        const [hostPort] = decoded.split('$');
        return `https://${hostPort}`;
      } catch {
        return null;
      }
    })();

// =============================================================================
// 5. 유틸 함수
// =============================================================================

/**
 * Kibana Agent Builder 전용 헤더
 *
 * KIBANA_CHAT_API_KEY가 설정된 경우 해당 키를 사용한다.
 * 이 키는 enterprise-knowledge 인덱스 read 권한과 Kibana Agent Builder
 * 기능 권한만을 가진 최소 권한 API 키여야 한다.
 *
 * KIBANA_CHAT_API_KEY가 비어 있으면 ES_API_KEY를 폴백으로 사용한다.
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
 * ES|QL에서 문자열은 큰따옴표로 감싸므로 쿼리 텍스트 내 " 와 \ 를 이스케이프한다.
 * 이를 통해 쿼리 인젝션(ES|QL injection)을 방지한다.
 *
 * @param  {string} text  원본 검색어
 * @returns {string}      ES|QL 문자열 리터럴 안에 안전하게 삽입 가능한 텍스트
 */
function esqlEscape(text) {
  return text
    .replace(/\\/g, '\\\\')   // 백슬래시를 먼저 이스케이프
    .replace(/"/g,  '\\"');   // 큰따옴표 이스케이프
}

/**
 * ES|QL 응답(컬럼/값 테이블 형식)을 /api/search 표준 hits 배열로 변환
 *
 * ES|QL 응답 구조:
 *   { columns: [{name, type}], values: [[v1, v2, ...], ...] }
 *
 * 변환 결과:
 *   [{ score, title, content, ... }, ...]
 *
 * @param  {{ columns: Array, values: Array }} esqlResult
 * @returns {Array<Object>}
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
    // ES|QL은 highlight를 지원하지 않음
    hit.highlight = {};

    // 동일 title 중복 제거 (ES|QL은 collapse 미지원)
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
      kibana_url: KIBANA_URL || '(not configured)',
      apm_active: apm.isStarted(),
    });
  } catch (err) {
    apm.captureError(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// =============================================================================
// 7. /api/search  — Lexical / Vector / Hybrid 검색
// =============================================================================
/**
 * POST /api/search
 *
 * Body:
 *   query      {string}  검색어 (필수)
 *   searchType {string}  'lexical' | 'vector' | 'hybrid'  (기본: 'hybrid')
 *   index      {string}  대상 인덱스 (기본: 'search-demo')
 *   size       {number}  반환 건수   (기본: 10)
 *
 * Response:
 *   took   {number}  ES 응답 소요시간 (ms)
 *   total  {number}  전체 매칭 건수
 *   hits   {Array}   검색 결과 (score, highlight 포함)
 */
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

  // APM 커스텀 스팬: Kibana APM UI > Transactions 에서 확인 가능
  const span = apm.startSpan(`search:${searchType}`, 'elasticsearch');
  // APM 커스텀 레이블: 검색 유형별 성능 비교에 활용
  apm.setLabel('search.type', searchType);
  apm.setLabel('search.query', query.slice(0, 100));

  try {

    // ------------------------------------------------------------------
    // 7-A. Lexical Search (BM25 multi_match — Query DSL)
    //      title(text) + content_text(text) 두 필드를 대상으로 BM25 검색.
    //      content_text는 semantic_text인 content와 동일한 원문을 text 타입으로
    //      저장한 필드로, lexical/vector/hybrid 모두 동일 본문 데이터를 대상으로
    //      검색할 수 있도록 한다.
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

      // setCustomContext: 레이블(1024자 제한)과 달리 길이 제한 없이 전체 쿼리 저장
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
    // 7-B. Vector Search (Semantic — semantic_text 필드)
    //      content 필드(semantic_text)를 대상으로 semantic 쿼리 실행.
    //      content 필드는 lexical의 content_text와 동일한 문서 본문 데이터를
    //      의미론적으로 인덱싱한 것이므로 동일 데이터 대상 검색.
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
    // 7-C. Hybrid Search — ES|QL FORK / FUSE / RERANK
    //
    //  파이프라인 구조:
    //    1) FROM ... METADATA _id, _index, _score
    //    2) FORK — 검색 방식별 독립 실행
    //         branch 1: BM25 on title       (제목 키워드 매칭)
    //         branch 2: BM25 on content_text (본문 키워드 매칭)
    //         branch 3: Semantic on content  (semantic_text 의미론적 매칭)
    //    3) FUSE — RRF(Reciprocal Rank Fusion)으로 세 브랜치 결과 병합
    //    4) RERANK — Jina cross-encoder로 최종 재정렬
    //    5) SORT _score DESC | LIMIT size | KEEP 필요 필드
    //
    //  ※ FORK/FUSE는 각 브랜치를 독립 실행 후 RRF 병합 → OR 단일 쿼리 대비
    //     더 균형 잡힌 lexical+semantic 결과 생성
    //  ※ ES|QL은 highlight 미지원 → hit.highlight는 빈 객체
    //  ※ ES|QL 응답은 { columns, values } 테이블 형식 → esqlToHits()로 변환
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

    // setCustomContext: 길이 제한 없이 전체 ES|QL 쿼리 저장
    // Kibana APM > Transaction > Custom 탭에서 search_esql_query 필드로 확인
    apm.setCustomContext({ search_esql_query: esqlQuery });

    const result = await es.esql.query({ query: esqlQuery });

    return res.json({
      // ES|QL 응답의 took (ms)
      took:  result.took ?? 0,
      // ES|QL은 total 개념이 없음 — 실제 반환 행 수로 대체
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
/**
 * POST /api/chat
 *
 * Kibana Agent Builder의 "search-demo" 에이전트를 호출한다.
 * converse-async 엔드포인트를 사용해 SSE 스트림을 프론트엔드로 중계한다.
 *
 * 참고: https://www.elastic.co/docs/api/doc/kibana/operation/operation-post-agent-builder-converse
 *
 * Body:
 *   input           {string}  사용자 메시지 (필수)
 *   conversation_id {string}  이전 대화 ID (선택 — 멀티턴 대화 유지)
 *
 * Response (SSE):
 *   event: chunk  → { text: string }          LLM 응답 텍스트 청크
 *   event: done   → { conversation_id: string, steps: Array }  완료
 *   event: error  → { message: string }        오류
 *
 * Kibana Agent Builder Converse 응답 구조 (동기):
 *   {
 *     response:        { message: string },
 *     conversation_id: string,
 *     steps:           [{ type, reasoning, tool_id, params, results }]
 *   }
 *
 * 스트리밍 방식:
 *   - converse-async: SSE 스트림 직접 반환 (Kibana → Backend → Frontend 중계)
 *   - converse:       동기 응답 → 단일 SSE 이벤트로 래핑
 *   현재는 converse (동기) 방식을 사용하고 응답을 SSE로 전달한다.
 *   스트리밍이 필요하면 아래 ENDPOINT 상수를 'converse-async'로 변경하면 된다.
 */
const AGENT_ID       = 'search-demo';
const CONVERSE_PATH  = '/api/agent_builder/converse';        // 동기 응답
// const CONVERSE_PATH = '/api/agent_builder/converse-async'; // SSE 스트리밍

app.post('/api/chat', async (req, res) => {
  const { input, conversation_id } = req.body;

  if (!input?.trim()) {
    return res.status(400).json({ error: 'input은 필수입니다.' });
  }

  // SSE 헤더 설정 (동기/비동기 모두 동일한 인터페이스로 프론트에 전달)
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

    // ------------------------------------------------------------------
    // Agent Builder Converse API 호출
    //
    // POST {KIBANA_URL}/api/agent_builder/converse
    // Headers:
    //   Authorization: ApiKey {ES_API_KEY}
    //   kbn-xsrf: true
    //   Content-Type: application/json
    //
    // Body:
    //   input           - 사용자 입력 (현재 메시지)
    //   agent_id        - "search-demo" (Agent Builder에서 생성한 에이전트 ID)
    //   conversation_id - 이전 턴의 conversation_id (멀티턴 유지)
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // 8-A. converse-async 사용 시: Kibana SSE 스트림을 프론트로 직접 중계
    // ------------------------------------------------------------------
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
        buffer = lines.pop();   // 마지막 불완전 줄 버퍼 보관

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const chunk = JSON.parse(raw);
            // 응답 텍스트 청크 중계
            if (chunk.response?.message) {
              sendEvent('chunk', { text: chunk.response.message });
            }
            // conversation_id 수집 (마지막 청크에 포함될 수 있음)
            if (chunk.conversation_id) {
              finalConversationId = chunk.conversation_id;
            }
            // 종료 신호
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

    // ------------------------------------------------------------------
    // 8-B. converse (동기) 사용 시: 응답을 SSE 단일 이벤트로 래핑
    //      응답 구조: { response: { message }, conversation_id, steps[] }
    // ------------------------------------------------------------------
    } else {
      const body = await agentResponse.json();

      // 응답 메시지를 청크 단위로 전송 (프론트 타이핑 효과)
      const message = body.response?.message ?? '';
      const CHUNK   = 30;   // 한 번에 전송할 글자 수

      for (let i = 0; i < message.length; i += CHUNK) {
        sendEvent('chunk', { text: message.slice(i, i + CHUNK) });
        // 타이핑 효과: 너무 빠르면 0ms, 적당히 느리게 하려면 10~20ms
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
// 9. /api/seed  — 테스트 데이터 인덱싱 (lexical 전용 인덱스)
//    semantic 검색까지 테스트하려면 인덱스에 semantic_text 필드가 필요함.
//    Kibana Dev Tools에서 아래 매핑을 먼저 생성하세요:
//
//    PUT search-demo
//    {
//      "mappings": {
//        "properties": {
//          "title":            { "type": "text" },
//          "content":          { "type": "text" },
//          "content_semantic": { "type": "semantic_text" },  ← ELSER/E5 자동 임베딩
//          "tags":             { "type": "keyword" },
//          "category":         { "type": "keyword" },
//          "created_at":       { "type": "date" }
//        }
//      }
//    }
// =============================================================================
app.post('/api/seed', async (req, res) => {
  const { count = 50, index = 'search-demo' } = req.body;
  const span = apm.startSpan('seed:bulk-index', 'elasticsearch');

  try {
    const { faker } = await import('@faker-js/faker');

    // 인덱스가 없으면 기본 매핑으로 생성 (semantic_text 없이 lexical 전용)
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
// 10. 서버 시작
// =============================================================================
app.listen(PORT, () => {
  console.log(`\n🚀 Backend: http://localhost:${PORT}`);
  console.log(`   APM:     ${apm.isStarted() ? process.env.APM_SERVER_URL : '비활성화'}`);
  console.log(`   Kibana:  ${KIBANA_URL || '(KIBANA_URL 미설정 — Cloud ID 자동 감지 실패)'}\n`);
});
