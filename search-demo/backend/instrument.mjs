/**
 * instrument.mjs — APM 사전 초기화 (ESM 환경)
 *
 * ESM에서는 static import가 모두 호이스팅되므로,
 * index.js 내부에서 apm.start()를 호출하면 express/http 모듈이
 * 이미 로드된 이후에 APM이 시작되어 HTTP 자동 계측이 동작하지 않는다.
 *
 * 해결책: --import ./instrument.mjs 플래그로 이 파일을 메인 모듈보다
 * 먼저 실행하여, APM이 express/http 로드 전에 계측 훅을 설치하도록 한다.
 *
 * 실행 순서:
 *   1) instrument.mjs 실행 (dotenv 로딩 → APM start)
 *   2) src/index.js의 import 처리 (express, cors, @elastic/elasticsearch)
 *   3) src/index.js 모듈 본문 실행
 */

// 1. 환경변수 먼저 로딩 (APM 설정값 사용 전)
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

// 2. APM 시작 (express/http import 전)
const { default: apm } = await import('elastic-apm-node');

apm.start({
  serviceName:  process.env.APM_SERVICE_NAME || 'search-demo-backend',
  serverUrl:    process.env.APM_SERVER_URL,
  secretToken:  process.env.APM_SECRET_TOKEN,
  environment:  process.env.NODE_ENV || 'development',
  // APM_SERVER_URL이 없으면 비활성화
  active:       !!process.env.APM_SERVER_URL,
  // 에러 발생 시 요청 body 캡처
  captureBody:  'errors',
  // 분산 추적 활성화 (기본값 true — 명시적으로 설정)
  // 백엔드 APM 에이전트는 인입 요청의 traceparent/tracestate 헤더를 자동으로 읽어
  // RUM → Backend 간 분산 추적을 연결한다.
  // ※ distributedTracingOrigins 는 RUM(브라우저) 전용 옵션 — Node.js 에이전트에서 제거
  usePathAsTransactionName: true,
  // 성능 오버헤드 최소화
  transactionSampleRate: 1.0,
});
