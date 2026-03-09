import os
import time
import random
import getpass
import warnings
import urllib3
from collections import deque
from datasets import load_dataset
from elasticsearch import Elasticsearch
from elasticsearch.exceptions import ElasticsearchWarning
from elasticsearch.helpers import parallel_bulk

# 데모 시연의 깔끔한 터미널 출력을 위해 SSL 및 ES 경고 메시지 숨김 처리
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.simplefilter('ignore', ElasticsearchWarning)

# ==========================================
# 🔐 0. Elasticsearch 클러스터 연결 설정 (사용자 입력)
# ==========================================
def connect_to_es():
    print("\n🔌 [Setup] Elasticsearch 클러스터 연결 정보를 확인합니다.")
    es_url = os.environ.get("ES_URL") or input("Elasticsearch URL [기본값: https://localhost:9200]: ") or "https://localhost:9200"
    es_user = os.environ.get("ES_USER") or input("Username [기본값: elastic]: ") or "elastic"
    
    es_pass = os.environ.get("ES_PASSWORD")
    if not es_pass:
        es_pass = getpass.getpass("Password (화면에 보이지 않습니다): ")

    print(f"[{es_url}] 클러스터로 연결을 시도합니다...")
    client = Elasticsearch(es_url, basic_auth=(es_user, es_pass), verify_certs=False)
    
    if client.ping():
        print("✅ 클러스터 연결 성공!\n")
        return client
    else:
        raise ConnectionError("❌ 클러스터 연결에 실패했습니다.")

es = connect_to_es()

INDEX_REAL_LEGACY = "demo-real-legacy-8x"
INDEX_REAL_MODERN = "demo-real-modern-9x"
VECTOR_DIMS = 1024

print("🚀 [Setup] 1. EIS 모델 세팅 중 (Jina v5 Inference)...")
try:
    es.inference.put(task_type="text_embedding", inference_id="my-jina-embedding", body={"service": "elastic", "service_settings": {"model_id": "jina-embeddings-v5-text-small"}})
    es.inference.put(task_type="rerank", inference_id="my-jina-reranker", body={"service": "elastic", "service_settings": {"model_id": "jina-reranker-v3"}})
except Exception: pass

print("🚀 [Setup] 2. Legacy 파이프라인 및 두 가지 인덱스 생성 중...")
es.indices.delete(index=[INDEX_REAL_LEGACY, INDEX_REAL_MODERN], ignore_unavailable=True)

es.ingest.put_pipeline(
    id="legacy-inference-pipeline",
    body={"processors": [{"inference": {"model_id": "my-jina-embedding", "target_field": "title_vector", "field_map": {"title": "text_field"}}}]}
)

es.indices.create(index=INDEX_REAL_LEGACY, body={
    "mappings": {
        "properties": {
            "title": {"type": "text"},
            "title_vector": {"type": "dense_vector", "dims": VECTOR_DIMS, "element_type": "float32", "index": True},
            "category": {"type": "keyword"},
            "access_level": {"type": "keyword"}
        }
    }
})

es.indices.create(index=INDEX_REAL_MODERN, body={
    "mappings": {
        "properties": {
            "content_semantic": {"type": "semantic_text", "inference_id": "my-jina-embedding"},
            "title": {"type": "text", "copy_to": "content_semantic"},
            "category": {"type": "keyword"},
            "access_level": {"type": "keyword"}
        }
    }
})

print("🚀 [Setup] 3. KLUE 한국어 뉴스 데이터(약 45,000건) 다운로드 및 색인 중...")
dataset = load_dataset("klue", "ynat", split="train")
label_map = {0: "IT/과학", 1: "경제", 2: "사회", 3: "생활문화", 4: "세계", 5: "스포츠", 6: "정치"}

def generate_real_data(index_name, use_pipeline=False):
    for i, row in enumerate(dataset):
        access_level = "premium" if random.random() < 0.01 else "public"
        action = {"_index": index_name, "_id": str(i), "_source": {"title": row["title"], "category": label_map.get(row["label"], "기타"), "access_level": access_level}}
        if use_pipeline: action["pipeline"] = "legacy-inference-pipeline"
        yield action

print("   -> [Legacy] 파이프라인을 통한 float32 임베딩 진행 중...")
deque(parallel_bulk(es, generate_real_data(INDEX_REAL_LEGACY, use_pipeline=True), thread_count=2, chunk_size=200), maxlen=0)

print("   -> [Modern] semantic_text를 통한 자동 최적화 색인 진행 중...")
deque(parallel_bulk(es, generate_real_data(INDEX_REAL_MODERN, use_pipeline=False), thread_count=2, chunk_size=200), maxlen=0)

print("🚀 [Setup] 4. 세그먼트 최적화 (Force Merge) 수행 중...")
es.indices.forcemerge(index=[INDEX_REAL_LEGACY, INDEX_REAL_MODERN], max_num_segments=1)
es.indices.refresh(index=[INDEX_REAL_LEGACY, INDEX_REAL_MODERN])

print("✅ 모든 사전 준비가 완료되었습니다! 내일 데모에서는 2_live_demo.py 만 실행하십시오.")