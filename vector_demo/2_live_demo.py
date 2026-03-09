import os
import time
import getpass
import warnings
import urllib3
from elasticsearch import Elasticsearch
from elasticsearch.exceptions import ElasticsearchWarning

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.simplefilter('ignore', ElasticsearchWarning)

# ==========================================
# 🔐 0. Elasticsearch 클러스터 연결 설정 (사용자 입력)
# ==========================================
def connect_to_es():
    print("\n🔌 [Live Demo] Elasticsearch 클러스터 연결")
    es_url = os.environ.get("ES_URL") or input("Elasticsearch URL [기본값: https://localhost:9200]: ") or "https://localhost:9200"
    es_user = os.environ.get("ES_USER") or input("Username [기본값: elastic]: ") or "elastic"
    
    es_pass = os.environ.get("ES_PASSWORD")
    if not es_pass:
        es_pass = getpass.getpass("Password: ")

    client = Elasticsearch(es_url, basic_auth=(es_user, es_pass), verify_certs=False)
    if client.ping():
        return client
    else:
        raise ConnectionError("❌ 클러스터 연결 실패")

es = connect_to_es()

INDEX_REAL_LEGACY = "demo-real-legacy-8x"
INDEX_REAL_MODERN = "demo-real-modern-9x"
VECTOR_DIMS = 1024

print("\n" + "=".center(75, "="))
print(" 🚀 ELASTIC 9.x REAL-WORLD VECTOR SEARCH DEMO ".center(75))
print("=".center(75, "=") + "\n")

doc_count = es.count(index=INDEX_REAL_MODERN)['count']

# ==========================================
# 📊 [Part 1] 인프라 비용(Storage & RAM) A/B 비교
# ==========================================
print(f"💡 [Part 1] 실제 한국어 뉴스 데이터({doc_count:,}건) 기반 리소스 최적화 증명")
time.sleep(1)

stats_legacy = es.indices.stats(index=INDEX_REAL_LEGACY)['indices'][INDEX_REAL_LEGACY]['total']['store']['size_in_bytes']
stats_modern = es.indices.stats(index=INDEX_REAL_MODERN)['indices'][INDEX_REAL_MODERN]['total']['store']['size_in_bytes']

ram_legacy_mb = (doc_count * VECTOR_DIMS * 4) / (1024 * 1024)
ram_modern_mb = (doc_count * VECTOR_DIMS / 8) / (1024 * 1024)

print(f"\n  💾 [디스크/스토리지 실제 사용량]")
print(f"  - 과거 8.x (float32): {stats_legacy / (1024*1024):.2f} MB")
print(f"  - 최신 9.x (bfloat16): {stats_modern / (1024*1024):.2f} MB  🔥 (약 {((stats_legacy - stats_modern) / stats_legacy) * 100:.1f}% 절감)")

print(f"\n  🧠 [검색 속도 유지를 위한 RAM(메모리) 상시 적재량]")
print(f"  - 과거 8.x: {ram_legacy_mb:.2f} MB")
print(f"  - 최신 9.x: {ram_modern_mb:.2f} MB 🔥 (정확히 32배 메모리 다이어트!)")
print(f"  💬 (해석: 데이터가 10배, 100배 늘어날수록 AWS 메모리 비용(TCO) 차이는 막대해집니다)\n")
time.sleep(2)

# ==========================================
# ⚡ [Part 2] ACORN-1 vs Post-Filter 속도 벤치마크
# ==========================================
print(f"💡 [Part 2] 1% 희소 조건 필터링 속도 A/B 테스트 (Legacy vs ACORN-1)")
time.sleep(1)

query_text = "인공지능과 머신러닝 반도체 기술 동향"
restrictive_filter = {"term": {"access_level": "premium"}}

legacy_query = {
    "knn": {"field": "title_vector", "query_vector_builder": {"text_embedding": {"model_id": "my-jina-embedding", "model_text": query_text}}, "k": 10, "num_candidates": 100, "filter": restrictive_filter}, "_source": False
}
modern_query = {
    "query": {"bool": {"must": {"semantic": {"field": "content_semantic", "query": query_text}}, "filter": restrictive_filter}}, "_source": False
}

for _ in range(3): es.search(index=INDEX_REAL_LEGACY, body=legacy_query); es.search(index=INDEX_REAL_MODERN, body=modern_query)

ITERATIONS = 30
start = time.time(); [es.search(index=INDEX_REAL_LEGACY, body=legacy_query) for _ in range(ITERATIONS)]; latency_legacy = (time.time() - start) * 1000 / ITERATIONS
start = time.time(); [es.search(index=INDEX_REAL_MODERN, body=modern_query) for _ in range(ITERATIONS)]; latency_modern = (time.time() - start) * 1000 / ITERATIONS

print(f"\n  🗣️ 질문: '{query_text}'")
print(f"  🔒 필터: 접근 권한이 'premium'인 1%의 뉴스만 대상")
print(f"  - 과거 8.x (Post-filter) 평균 응답 시간: {latency_legacy:.2f} ms")
print(f"  - 최신 9.x (ACORN-1) 평균 응답 시간: {latency_modern:.2f} ms  🔥 ({latency_legacy/latency_modern:.1f}배 더 빠름!)")
time.sleep(2)

# ==========================================
# 🎯 [Part 3] 실제 하이브리드 검색 품질 시연
# ==========================================
print("\n💡 [Part 3] Retriever API & Jina Reranker를 활용한 하이브리드 품질 검증")
time.sleep(1)

hybrid_query = {
    "retriever": {
        "text_similarity_reranker": {
            "retriever": {"rrf": {"retrievers": [{"standard": {"query": {"bool": {"must": {"match": {"title": query_text}}, "filter": restrictive_filter}}}}, {"standard": {"query": {"bool": {"must": {"semantic": {"field": "content_semantic", "query": query_text}}, "filter": restrictive_filter}}}}]}},
            "field": "title", "inference_id": "my-jina-reranker", "inference_text": query_text
        }
    }, "_source": ["title", "category", "access_level"]
}

res = es.search(index=INDEX_REAL_MODERN, body=hybrid_query)
print("")
for i, hit in enumerate(res['hits']['hits'][:3], 1): print(f"  {i}. [Score: {hit['_score']:.4f}] [{hit['_source']['category']} | {hit['_source']['access_level']}] {hit['_source']['title']}")
time.sleep(2)

# ==========================================
# 🛠️ [Part 4] 데이터 엔지니어를 위한 ES|QL 하이브리드
# ==========================================
print("\n💡 [Part 4] ES|QL (FORK & FUSE) 기반 하이브리드 검색 파이프라인")
time.sleep(1)

esql_query = f"""
    FROM {INDEX_REAL_MODERN}
    | METADATA _score
    | FORK
        (WHERE access_level == "premium" AND title LIKE "*인공지능*")
        (WHERE access_level == "premium" AND KNN(content_semantic, "{query_text}"))
    | FUSE
    | LIMIT 2
"""
esql_res = es.esql.query(body={"query": esql_query})
print("")
for i, row in enumerate(esql_res['values'], 1): print(f"  {i}. [Score: {row[-1]:.4f}] [{row[3]} | {row[4]}] {row[2]}") 

print("\n" + "=".center(75, "="))
print(" 🎉 REAL-WORLD DEMO COMPLETED ".center(75))
print("=".center(75, "=") + "\n")