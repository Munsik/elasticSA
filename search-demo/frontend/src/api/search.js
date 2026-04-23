import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
});

/**
 * 검색 API — searchType에 따라 lexical / vector / hybrid 검색 수행
 * @param {string} query      검색어
 * @param {string} searchType 'lexical' | 'vector' | 'hybrid'
 * @param {string} [index]    대상 인덱스 (기본: enterprise-knowledge)
 * @param {number} [size]     반환 건수  (기본: 10)
 */
export const search = (query, searchType = 'hybrid', index = 'enterprise-knowledge', size = 10) =>
  api.post('/api/search', { query, searchType, index, size }).then((r) => r.data);

export const healthCheck = () =>
  api.get('/api/health').then((r) => r.data);

/**
 * Behavioral Analytics 이벤트 전송
 *
 * eventType: 'search' | 'click'
 *
 * [search 이벤트 payload 구조]
 * {
 *   search: {
 *     query:        string,          // 검색어
 *     search_type:  string,          // 커스텀 필드 — Kibana 필터용 (lexical/vector/hybrid)
 *     results: {
 *       total_results: number,
 *       items: [{ document: { id, index }, page: { current } }, ...]
 *     }
 *   },
 *   session: { id: string }          // 탭 단위 세션 ID
 * }
 *
 * [click 이벤트 payload 구조]
 * {
 *   search: {
 *     query:       string,
 *     search_type: string,
 *   },
 *   document: {
 *     id:    string,                 // 클릭한 문서 ID
 *     index: string,                 // 인덱스명
 *   },
 *   page: { current: 1 },
 *   session: { id: string }
 * }
 *
 * @param {'search'|'click'} eventType
 * @param {Object}           payload
 */
export const sendAnalyticsEvent = (eventType, payload) =>
  api
    .post('/api/analytics/event', { eventType, payload })
    .catch(() => { /* Analytics 실패는 검색 UX에 영향을 주지 않도록 무시 */ });
