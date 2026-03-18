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
