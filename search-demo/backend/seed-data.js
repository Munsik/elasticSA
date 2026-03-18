/**
 * seed-data.js — enterprise-knowledge 인덱스 생성 및 10만 건 데이터 색인
 *
 * 데이터 특성:
 *   - 사내 IT 헬프데스크 티켓, HR 정책 문서, 기술 위키, FAQ 등
 *   - 모든 콘텐츠는 한국어 또는 영어로만 작성
 *   - 실제 기업 환경을 반영한 현실적인 제목/본문
 *
 * 실행: node seed-data.js
 *        node seed-data.js --force          (인덱스 재생성)
 *        node seed-data.js --count=5000     (건수 지정)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

import { Client } from '@elastic/elasticsearch';
import { faker }  from '@faker-js/faker/locale/ko'; // 한국어 locale (이름, 날짜 등)

// =============================================================================
// 설정
// =============================================================================
const INDEX_NAME     = 'enterprise-knowledge';
const CHUNK_SIZE     = 500;   // semantic_text 임베딩 처리 부하 고려해 500으로 축소
const TOTAL_DOCS     = (() => {
  const arg = process.argv.find((a) => a.startsWith('--count='));
  return arg ? parseInt(arg.split('=')[1], 10) : 100_000;
})();
const FORCE_RECREATE = process.argv.includes('--force');

// =============================================================================
// Elasticsearch 클라이언트
// =============================================================================
const es = new Client({
  cloud: { id: process.env.ES_CLOUD_ID },
  auth:  { apiKey: process.env.ES_API_KEY },
});

// =============================================================================
// 인덱스 매핑
// =============================================================================
const INDEX_MAPPING = {
  mappings: {
    properties: {
      title:        { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 512 } } },
      content:      { type: 'semantic_text', inference_id: '.jina-embeddings-v5-text-small' },
      content_text: { type: 'text' },   // BM25 lexical 검색용 (content와 동일 데이터)
      author:      { type: 'keyword' },
      department:  { type: 'keyword' },
      category:    { type: 'keyword' },
      status:      { type: 'keyword' },
      view_count:  { type: 'integer' },
      is_resolved: { type: 'boolean' },
      created_at:  { type: 'date' },
      updated_at:  { type: 'date' },
    },
  },
  settings: {
    number_of_shards:   1,
    number_of_replicas: 1,
    refresh_interval:  '30s',
  },
};

// =============================================================================
// 콘텐츠 소스 데이터 (한국어/영어)
// =============================================================================

const DEPARTMENTS = ['IT운영팀', 'HR팀', '재무팀', '법무팀', '마케팅팀', '개발팀', '정보보안팀', '구매팀', '고객성공팀', '데이터팀'];

const AUTHORS = [
  '김민준', '이서연', '박지호', '최유나', '정현우', '강소희', '윤도현', '임채원',
  '한지수', '오승민', '서예진', '권태양', '황미래', '신동혁', '류지원', '백성우',
  'James Kim', 'Sarah Park', 'Michael Lee', 'Jennifer Choi',
];

// ── 카테고리별 문서 템플릿 ─────────────────────────────────────────────────

const TEMPLATES = {

  // ── IT 헬프데스크 티켓 ──────────────────────────────────────────────────
  helpdesk_it: [
    {
      title: () => pick([
        'VPN 접속이 되지 않아요', 'VPN 연결 오류 - L2TP 프로토콜 실패',
        '재택근무 중 VPN 속도가 너무 느립니다', 'GlobalProtect VPN 인증 오류',
        '노트북 새로 받았는데 VPN 설정 방법을 모르겠어요',
      ]),
      content: () => `## 문제 상황\n\n${pick([
        '오늘 아침부터 VPN이 갑자기 연결되지 않습니다. 어제까지는 정상이었는데 오늘 출근 후 접속을 시도하면 "인증 실패" 오류가 발생합니다.',
        '재택근무 시작 후 VPN을 연결했는데 인터넷 속도가 매우 느려집니다. 내부 시스템 접근은 되지만 파일 다운로드 속도가 1Mbps 이하로 떨어집니다.',
        'GlobalProtect 클라이언트에서 "Unable to connect to the gateway" 오류가 지속적으로 발생합니다.',
      ])}\n\n## 시도한 방법\n\n- VPN 클라이언트 재시작\n- 컴퓨터 재부팅\n- 네트워크 설정 초기화\n\n## 환경\n\n- OS: ${pick(['Windows 11 Pro', 'macOS Ventura 13.5', 'Windows 10 Enterprise'])}\n- VPN 클라이언트: GlobalProtect 6.x\n- 네트워크: ${pick(['유선 LAN', '무선 Wi-Fi (가정용)', '사무실 네트워크'])}\n\n## 조치 방법\n\n1. GlobalProtect 클라이언트를 완전히 제거 후 최신 버전(6.2.x) 재설치\n2. IT 포털(itportal.company.com)에서 인증서 재발급\n3. 방화벽 예외 설정: UDP 4501, TCP 443 포트 허용\n4. 문제 지속 시 IT 헬프데스크(#it-support Slack 채널)에 원격 지원 요청`,
    },
    {
      title: () => pick([
        '비밀번호 만료 - 초기화 방법 문의', '계정 잠금 해제 요청', 'AD 비밀번호 변경 후 Outlook 동기화 안됨',
        '비밀번호 복잡성 정책 안내', 'MFA 인증 앱 기기 교체 방법',
      ]),
      content: () => `## 개요\n\n사내 계정 비밀번호 정책 및 초기화 절차 안내입니다.\n\n## 비밀번호 정책\n\n- **최소 길이**: 12자 이상\n- **복잡성**: 대문자, 소문자, 숫자, 특수문자 각 1개 이상 포함\n- **변경 주기**: 90일마다 강제 변경\n- **재사용 제한**: 최근 10개 비밀번호 재사용 불가\n\n## 비밀번호 초기화 절차\n\n### 방법 1: 셀프 서비스 포털\n1. [비밀번호 초기화 포털](https://password.company.com) 접속\n2. 사번 입력 후 등록된 휴대폰으로 OTP 수신\n3. 새 비밀번호 설정 (정책 기준 충족 필수)\n\n### 방법 2: IT 헬프데스크 직접 요청\n- Slack: #it-support 채널에 사번과 이름 전송\n- 전화: 내선 1234 (평일 09:00-18:00)\n- 이메일: helpdesk@company.com\n\n## 주의사항\n\n- 비밀번호 변경 후 Outlook, 모바일 메일 앱의 계정 정보를 갱신해야 합니다.\n- 3회 연속 오류 입력 시 계정이 자동 잠금됩니다.`,
    },
    {
      title: () => pick([
        '사내 소프트웨어 설치 요청 - Adobe Creative Cloud',
        'Python 개발 환경 구성 가이드', 'Docker Desktop 설치 승인 요청',
        'VS Code 확장 프로그램 설치 정책', 'Slack 데스크탑 앱 업데이트 안내',
      ]),
      content: () => `## 개요\n\n사내 소프트웨어 설치 정책 및 요청 절차를 안내합니다.\n\n## 사전 승인 필요 소프트웨어\n\n아래 카테고리의 소프트웨어는 IT 운영팀 및 보안팀의 사전 승인이 필요합니다.\n\n| 카테고리 | 예시 | 승인 부서 |\n|---|---|---|\n| 개발 도구 | Docker, Kubernetes 클라이언트 | IT운영팀 |\n| 크리에이티브 | Adobe CC, Figma | 구매팀 + IT운영팀 |\n| 보안 도구 | Wireshark, Burp Suite | 정보보안팀 |\n| 데이터베이스 클라이언트 | DBeaver, DataGrip | IT운영팀 |\n\n## 설치 요청 방법\n\n1. [IT 서비스 포털](https://itsm.company.com) > Software Request 메뉴\n2. 소프트웨어명, 버전, 사용 목적, 비용(유료인 경우) 입력\n3. 팀장 사전 승인 후 제출\n4. IT운영팀 검토 후 설치 진행 (평균 1-2 영업일 소요)\n\n## 무승인 설치 가능 소프트웨어\n\n- ${pick(['VS Code, Git, Node.js, Python (공식 배포판)', 'Chrome, Firefox, Zoom, Slack (최신 버전 자동 갱신)', '7-Zip, Notepad++, draw.io Desktop'])}`,
    },
  ],

  // ── HR 정책 문서 ────────────────────────────────────────────────────────
  hr_policy: [
    {
      title: () => pick([
        '연차 휴가 사용 규정 및 신청 방법', '반차/반반차 제도 안내',
        '육아휴직 신청 절차 및 급여 지원', '병가 처리 규정 (2024년 개정)',
        '재량휴가 및 창립기념일 휴무 안내',
      ]),
      content: () => `## 연차 휴가 기본 제도\n\n### 발생 기준\n- 입사 1년 미만: 매월 개근 시 1일 발생 (최대 11일)\n- 입사 1년 이상: 15일 기본 + 2년마다 1일 가산 (최대 25일)\n\n### 신청 방법\n1. HR 포털(hr.company.com) 접속\n2. 휴가 신청 > 연차 선택\n3. 사용 일자 및 업무 인수인계 계획 입력\n4. **팀장 승인 필수** (긴급 휴가는 사후 신청 가능)\n\n### 연차 촉진 제도\n- 매년 ${pick(['6월 30일', '9월 30일'])}까지 잔여 연차의 50% 이상 소진 권고\n- 미사용 연차는 ${pick(['다음해 3월까지 이월 가능 (최대 10일)', '연도 내 소진 원칙, 미사용분 수당 지급'])} \n\n### 연차 외 특별 휴가\n| 구분 | 일수 | 비고 |\n|---|---|---|\n| 결혼 | 5일 | 본인 결혼 |\n| 배우자 출산 | 10일 | 유급 |\n| 부모/배우자 부모 사망 | 5일 | 유급 |\n| 형제자매 사망 | 3일 | 유급 |\n| 자녀 입학 | 1일 | 초등학교 |\n\n문의: hr@company.com | 내선 2000`,
    },
    {
      title: () => pick([
        '성과 평가 제도 안내 (H2 2024)', 'OKR 작성 가이드라인',
        '360도 피드백 프로세스 설명', '승진 심사 기준 및 일정',
        '성과급 지급 기준 안내',
      ]),
      content: () => `## 성과 평가 체계\n\n### 평가 주기\n- **반기 평가**: 6월, 12월 (정식 평가)\n- **분기 체크인**: 3월, 9월 (비공식 피드백)\n\n### 평가 등급\n| 등급 | 비율 | 설명 |\n|---|---|---|\n| S (Outstanding) | 10% | 기대를 크게 초과 |\n| A (Exceeds) | 25% | 기대를 초과 달성 |\n| B (Meets) | 50% | 기대에 부합 |\n| C (Below) | 15% | 개선 필요 |\n\n### OKR 작성 원칙\n1. **Objective**: 영감을 주는 정성적 목표 (1-3개)\n2. **Key Result**: 측정 가능한 수치 목표 (Objective당 2-4개)\n3. 분기 시작 2주 내 등록, 팀장과 합의 필수\n\n### 평가 일정 (H2 2024)\n- 자기 평가 제출: ${pick(['11월 25일까지', '12월 2일까지'])}\n- 팀장 평가 완료: ${pick(['12월 9일까지', '12월 13일까지'])}\n- 결과 통보: ${pick(['12월 말', '1월 초'])}\n\n문의: 인사기획팀 내선 2100`,
    },
  ],

  // ── 기술 위키 ───────────────────────────────────────────────────────────
  tech_wiki: [
    {
      title: () => pick([
        'AWS IAM 권한 관리 가이드', 'S3 버킷 보안 설정 체크리스트',
        'EC2 인스턴스 타입 선택 기준', 'RDS 백업 및 복구 절차',
        'CloudWatch 알람 설정 방법',
      ]),
      content: () => `## 개요\n\n${pick(['AWS IAM(Identity and Access Management) 권한을 최소 권한 원칙에 따라 관리하는 방법을 설명합니다.', 'AWS S3 버킷의 보안 설정을 점검하고 데이터 유출을 방지하는 체크리스트입니다.', 'EC2 인스턴스 타입 선택 시 고려해야 할 CPU, 메모리, 네트워크 기준을 안내합니다.'])}\n\n## 기본 원칙\n\n- **최소 권한 원칙(Least Privilege)**: 업무에 필요한 최소한의 권한만 부여\n- **역할 기반 접근 제어(RBAC)**: 개인 계정이 아닌 IAM Role에 권한 부여\n- **MFA 필수화**: 콘솔 로그인 및 민감한 API 작업에 MFA 적용\n\n## IAM 정책 작성 예시\n\n\`\`\`json\n{\n  "Version": "2012-10-17",\n  "Statement": [\n    {\n      "Effect": "Allow",\n      "Action": ["s3:GetObject", "s3:PutObject"],\n      "Resource": "arn:aws:s3:::company-data-bucket/*",\n      "Condition": {\n        "StringEquals": {"aws:RequestedRegion": "ap-northeast-2"}\n      }\n    }\n  ]\n}\n\`\`\`\n\n## 정기 점검 항목\n\n- [ ] 미사용 IAM 사용자 비활성화 (90일 이상 미접속)\n- [ ] Access Key 교체 (180일 주기)\n- [ ] 관리자 권한 보유 계정 목록 검토\n- [ ] CloudTrail 로그 이상 징후 모니터링\n\n관련 문서: [AWS 보안 기준](https://wiki.company.com/aws-security) | 문의: 정보보안팀`,
    },
    {
      title: () => pick([
        'Kubernetes 배포 가이드 (사내 클러스터)', 'Helm Chart 작성 표준',
        'CI/CD 파이프라인 구성 - GitHub Actions', 'Docker 이미지 빌드 최적화',
        'Prometheus + Grafana 모니터링 설정',
      ]),
      content: () => `## 개요\n\n사내 Kubernetes 클러스터(EKS)에 서비스를 배포하는 표준 절차입니다.\n\n## 사전 준비\n\n\`\`\`bash\n# kubectl 컨텍스트 확인\nkubectl config current-context\n# 출력 예시: arn:aws:eks:ap-northeast-2:123456789:cluster/company-prod\n\n# 네임스페이스 확인\nkubectl get namespaces\n\`\`\`\n\n## 배포 절차\n\n### 1. 이미지 빌드 및 푸시\n\`\`\`bash\n# ECR 로그인\naws ecr get-login-password --region ap-northeast-2 | \\\n  docker login --username AWS --password-stdin \\\n  123456789.dkr.ecr.ap-northeast-2.amazonaws.com\n\n# 이미지 빌드 및 태깅\ndocker build -t my-service:\${VERSION} .\ndocker tag my-service:\${VERSION} \\\n  123456789.dkr.ecr.ap-northeast-2.amazonaws.com/my-service:\${VERSION}\n\n# ECR 푸시\ndocker push 123456789.dkr.ecr.ap-northeast-2.amazonaws.com/my-service:\${VERSION}\n\`\`\`\n\n### 2. Helm 배포\n\`\`\`bash\nhelm upgrade --install my-service ./charts/my-service \\\n  --namespace production \\\n  --set image.tag=\${VERSION} \\\n  --set replicaCount=3 \\\n  --values values-prod.yaml\n\`\`\`\n\n### 3. 배포 검증\n\`\`\`bash\nkubectl rollout status deployment/my-service -n production\nkubectl get pods -n production -l app=my-service\n\`\`\`\n\n## 롤백 방법\n\n\`\`\`bash\n# 이전 버전으로 즉시 롤백\nhelm rollback my-service 0 --namespace production\n\`\`\`\n\n관련 링크: [사내 Helm Chart 레포](https://github.company.com/platform/helm-charts)`,
    },
    {
      title: () => pick([
        'Elasticsearch 인덱스 설계 가이드', 'ES 샤드 크기 최적화',
        'Kibana 대시보드 작성 표준', 'Logstash 파이프라인 구성',
        'Elastic APM 연동 가이드 (Node.js)',
      ]),
      content: () => `## 개요\n\nElastic Stack을 활용한 ${pick(['로그 수집 및 분석', '애플리케이션 성능 모니터링(APM)', '검색 서비스 구축'])} 가이드입니다.\n\n## 인덱스 설계 원칙\n\n### 매핑 전략\n- 텍스트 검색 필드: \`text\` 타입 + \`keyword\` 다중 필드\n- 시계열 데이터: \`date\` 타입, 인덱스 패턴에 날짜 포함 (예: \`logs-app-2024.01.15\`)\n- 정형 필터 필드: \`keyword\` 타입\n- 의미 검색: \`semantic_text\` 타입 (ELSER 또는 E5 모델)\n\n### 샤드 크기 권고\n| 데이터 규모 | Primary Shard 수 | 샤드당 크기 목표 |\n|---|---|---|\n| ~ 10GB | 1 | 10GB 이하 |\n| 10 ~ 100GB | 2-5 | 20-30GB |\n| 100GB 이상 | 조정 필요 | 최대 50GB |\n\n## Elastic APM Node.js 연동\n\n\`\`\`javascript\n// 반드시 앱 최상단 첫 번째 라인에서 실행\nimport apm from 'elastic-apm-node';\napm.start({\n  serviceName: 'my-service',\n  serverUrl: process.env.APM_SERVER_URL,\n  secretToken: process.env.APM_SECRET_TOKEN,\n  environment: process.env.NODE_ENV,\n});\n\`\`\`\n\n## 클러스터 접속 정보\n\n- 클러스터: [Elastic Cloud Console](https://cloud.elastic.co)\n- Kibana: [사내 Kibana](https://kibana.company.com)\n- 문의: 데이터팀 #elastic-ops 채널`,
    },
  ],

  // ── 보안 정책/공지 ────────────────────────────────────────────────────────
  security: [
    {
      title: () => pick([
        '피싱 이메일 신고 방법 및 대응 절차', '랜섬웨어 감염 시 즉각 조치 가이드',
        '사내 데이터 분류 및 취급 기준', '외부 USB 사용 정책 (2024 개정)',
        '개인정보 처리 및 보호 지침',
      ]),
      content: () => `## ${pick(['피싱 이메일 식별 및 신고 절차', '사내 데이터 보안 취급 기준', '악성코드 감염 대응 매뉴얼'])}\n\n### 위험 징후 식별\n\n다음과 같은 특징의 이메일은 피싱일 가능성이 높습니다:\n\n- **발신자 확인**: 회사 도메인(@company.com)이 아닌 유사 도메인 (예: @cornpany.com)\n- **긴급성 강조**: "오늘까지 처리하지 않으면 계정이 정지됩니다" 등의 문구\n- **첨부파일 주의**: 예상치 못한 .exe, .zip, .docm 파일\n- **링크 검증**: 마우스 오버 시 표시되는 URL과 링크 텍스트 불일치\n\n### 신고 절차\n\n1. **즉시 차단**: 해당 이메일을 열지 않고 스팸으로 신고\n2. **보안팀 알림**: security@company.com 또는 Slack #security-incident\n3. **이미 클릭한 경우**:\n   - 즉시 네트워크 연결 차단 (Wi-Fi 끄기)\n   - 보안팀에 즉각 연락 (24시간 핫라인: 내선 9999)\n   - 절대 혼자 조치하지 말 것\n\n### 데이터 분류 기준\n\n| 등급 | 설명 | 예시 |\n|---|---|---|\n| 기밀 (Confidential) | 외부 유출 시 심각한 피해 | 고객 개인정보, 금융 데이터 |\n| 내부용 (Internal) | 사내에서만 공유 | 내부 정책, 프로젝트 계획 |\n| 공개 (Public) | 외부 공개 가능 | 홈페이지 콘텐츠, 보도자료 |\n\n문의: 정보보안팀 | security@company.com`,
    },
  ],

  // ── 온보딩 가이드 ────────────────────────────────────────────────────────
  onboarding: [
    {
      title: () => pick([
        '신입 직원 IT 환경 설정 체크리스트', '첫날 해야 할 10가지',
        '사내 주요 시스템 접속 계정 신청 방법', '업무용 노트북 초기 설정 가이드',
        'Slack, Jira, Confluence 시작하기',
      ]),
      content: () => `## 환영합니다! 🎉\n\n입사를 진심으로 축하드립니다. 이 가이드는 첫 주 동안 IT 환경을 설정하는 데 도움을 드립니다.\n\n## Day 1 체크리스트\n\n### 계정 활성화\n- [ ] 사내 이메일 계정 확인 (인사팀에서 임시 비밀번호 제공)\n- [ ] 비밀번호 변경 (정책: 12자 이상, 대소문자+숫자+특수문자)\n- [ ] MFA(다중 인증) 등록 → [MFA 설정 페이지](https://mfa.company.com)\n- [ ] VPN 설치 및 테스트 → IT 포털에서 GlobalProtect 다운로드\n\n### 필수 툴 설치\n- [ ] **Slack** - 팀 커뮤니케이션 → 팀장이 채널 초대\n- [ ] **Zoom** - 화상 회의\n- [ ] **1Password** - 비밀번호 관리자 → IT팀에서 라이선스 발급\n- [ ] **노트북 암호화** 확인 (Windows: BitLocker / Mac: FileVault)\n\n### 접근 권한 신청\n\n[ITSM 포털](https://itsm.company.com) > New Request > 계정 생성에서 아래 시스템 접근 권한을 신청하세요:\n\n| 시스템 | 용도 | 승인자 |\n|---|---|---|\n| Jira | 업무 티켓 관리 | 팀장 |\n| Confluence | 위키/문서 관리 | 팀장 |\n| GitHub Enterprise | 코드 레포지토리 | 개발팀장 |\n| AWS Console | 클라우드 관리 | IT운영팀장 |\n\n## 도움이 필요하다면\n\n- Slack: **#it-support** (IT 문의)\n- Slack: **#help-hr** (인사/복지 문의)\n- IT 헬프데스크: 내선 **1234**\n- 이메일: helpdesk@company.com`,
    },
  ],

  // ── 운영 인시던트/장애 리포트 ─────────────────────────────────────────────
  incident: [
    {
      title: () => pick([
        '[해결됨] 사내 메일 수신 지연 (2024-11-15)',
        '[해결됨] ERP 시스템 접속 불가 - 긴급 패치 완료',
        '[조치 완료] AWS ap-northeast-2 네트워크 이상',
        '[공지] Confluence 서버 점검 안내 (12월 둘째 주 토요일)',
        '[완료] 사내 Wi-Fi 인증 서버 교체 작업',
      ]),
      content: () => `## 인시던트 요약\n\n- **발생 일시**: ${faker.date.recent({ days: 90 }).toISOString().slice(0, 16).replace('T', ' ')}\n- **해결 일시**: ${faker.date.recent({ days: 89 }).toISOString().slice(0, 16).replace('T', ' ')}\n- **영향 범위**: ${pick(['전 직원 이메일 서비스', '개발팀 AWS 접속', '본사 사무실 Wi-Fi', 'ERP 전체 사용자'])}\n- **심각도**: ${pick(['P1 (Critical)', 'P2 (High)', 'P3 (Medium)'])}\n\n## 원인\n\n${pick([
        'SSL 인증서 만료로 인한 HTTPS 연결 실패. 자동 갱신 스크립트 오작동.',
        'AWS RDS 인스턴스 스토리지 용량 초과 (95% 이상). 자동 알람 임계값 설정 누락.',
        '네트워크 스위치 펌웨어 업그레이드 후 VLAN 설정 초기화.',
        '사용자 급증으로 인한 인증 서버 CPU 100% 과부하.',
      ])}\n\n## 조치 내역\n\n1. ${pick(['영향 받은 서비스 즉시 롤백', '인증서 수동 갱신 적용', '스토리지 용량 증설 (500GB → 1TB)', '트래픽 임시 우회 처리'])}\n2. 근본 원인 분석 및 재발 방지 설정 적용\n3. 모니터링 알람 임계값 재설정\n\n## 재발 방지 대책\n\n- 인증서 만료 30일 전 자동 알람 추가\n- 스토리지 사용량 80% 초과 시 자동 용량 증설 정책 적용\n- 월 1회 인프라 헬스체크 프로세스 도입\n\n## 관련 티켓\n\n[JIRA-${faker.number.int({ min: 1000, max: 9999 })}](https://jira.company.com)`,
    },
  ],

  // ── 복리후생/사내 공지 ────────────────────────────────────────────────────
  announcement: [
    {
      title: () => pick([
        '2024년 하반기 사내 교육 프로그램 안내', '복지포인트 사용처 확대 안내 (2024.11)',
        '사내 카페테리아 메뉴 및 운영 시간 변경', '주차장 이용 규정 개정 안내',
        '건강검진 일정 및 신청 방법 (2024년)',
      ]),
      content: () => `## 공지 내용\n\n${pick([
        '2024년 하반기 직무 역량 강화를 위한 사내 교육 프로그램 일정을 안내드립니다.',
        '임직원 복지포인트 사용처가 확대되어 새로운 혜택을 안내드립니다.',
        '4분기 건강검진 일정 및 신청 방법을 안내드립니다.',
      ])}\n\n## 세부 내용\n\n### 일정\n- 신청 기간: ${faker.date.soon({ days: 7 }).toISOString().slice(0, 10)} ~ ${faker.date.soon({ days: 21 }).toISOString().slice(0, 10)}\n- 진행 기간: ${faker.date.soon({ days: 30 }).toISOString().slice(0, 10)} ~ ${faker.date.soon({ days: 60 }).toISOString().slice(0, 10)}\n\n### 신청 방법\n1. HR 포털(hr.company.com) 접속\n2. 복지 > 교육신청 메뉴 선택\n3. 원하는 프로그램 선택 후 신청\n4. 팀장 승인 후 확정 (3 영업일 이내)\n\n### 지원 프로그램 (일부)\n| 프로그램 | 대상 | 비용 |\n|---|---|---|\n| ${pick(['AWS Solutions Architect 자격증 대비반', 'SQL/데이터 분석 기초', '비즈니스 영어 회화'])} | 전 직원 | 회사 전액 지원 |\n| ${pick(['리더십 스킬 향상', 'PMP 자격증 과정', '파이썬 실무 활용'])} | ${pick(['팀장급 이상', '3년 이상 경력자', '전 직원'])} | 회사 전액 지원 |\n\n문의: HR팀 | hr@company.com | 내선 2000`,
    },
  ],
};

// =============================================================================
// 문서 생성 헬퍼
// =============================================================================
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const CATEGORY_WEIGHTS = [
  { category: 'IT 헬프데스크', templateKey: 'helpdesk_it',   status_pool: ['published', 'archived'],             weight: 35 },
  { category: '기술 위키',     templateKey: 'tech_wiki',      status_pool: ['published', 'draft', 'under_review'], weight: 25 },
  { category: 'HR 정책',       templateKey: 'hr_policy',      status_pool: ['published', 'archived'],             weight: 15 },
  { category: '보안',          templateKey: 'security',        status_pool: ['published'],                         weight: 10 },
  { category: '온보딩',        templateKey: 'onboarding',      status_pool: ['published', 'under_review'],         weight: 7  },
  { category: '인시던트',      templateKey: 'incident',        status_pool: ['published', 'archived'],             weight: 5  },
  { category: '사내 공지',     templateKey: 'announcement',    status_pool: ['published', 'archived'],             weight: 3  },
];

// 가중치 기반 카테고리 선택 (분포가 현실적으로 보이도록)
const WEIGHT_TABLE = CATEGORY_WEIGHTS.flatMap((c) =>
  Array.from({ length: c.weight }, () => c)
);

function generateDoc() {
  const cat        = WEIGHT_TABLE[Math.floor(Math.random() * WEIGHT_TABLE.length)];
  const templates  = TEMPLATES[cat.templateKey];
  const tpl        = templates[Math.floor(Math.random() * templates.length)];
  const createdAt  = faker.date.between({ from: '2022-01-01', to: '2025-06-30' });
  const updatedAt  = faker.date.between({ from: createdAt, to: new Date() });
  const status     = pick(cat.status_pool);
  const isResolved = cat.category === 'IT 헬프데스크'
    ? faker.datatype.boolean(0.78)   // IT 티켓은 78% 해결됨
    : faker.datatype.boolean(0.95);  // 나머지는 대부분 완료 상태

  const contentBody = tpl.content();
  return {
    title:        tpl.title(),
    content:      contentBody,   // semantic_text: 벡터 검색용
    content_text: contentBody,   // text: BM25 lexical 검색용 (동일 데이터)
    author:       pick(AUTHORS),
    department:  pick(DEPARTMENTS),
    category:    cat.category,
    status,
    view_count:  faker.number.int({ min: 0, max: 30_000 }),
    is_resolved: isResolved,
    created_at:  createdAt.toISOString(),
    updated_at:  updatedAt.toISOString(),
  };
}

// =============================================================================
// 진행률 출력
// =============================================================================
function printProgress(indexed, total, startTime) {
  const pct      = ((indexed / total) * 100).toFixed(1);
  const elapsed  = ((Date.now() - startTime) / 1000).toFixed(1);
  const speed    = (indexed / Math.max(elapsed, 0.1)).toFixed(0);
  const eta      = indexed > 0 ? ((total - indexed) / (indexed / elapsed)).toFixed(0) : '?';
  process.stdout.write(
    `\r  진행: ${String(indexed).padStart(7)} / ${total}  ` +
    `[${pct.padStart(5)}%]  ${speed} docs/s  경과: ${elapsed}s  ETA: ${eta}s   `
  );
}

// =============================================================================
// 메인
// =============================================================================
async function main() {
  console.log('='.repeat(65));
  console.log(' enterprise-knowledge 인덱스 시딩 (사내 헬프데스크/위키)');
  console.log(`  총 문서 수: ${TOTAL_DOCS.toLocaleString()}건  |  청크: ${CHUNK_SIZE}건`);
  console.log('='.repeat(65));

  // ES 연결 확인
  try {
    const info = await es.info();
    console.log(`\n✓ ES 연결: v${info.version.number} (${info.cluster_name})`);
  } catch (err) {
    console.error(`✗ ES 연결 실패: ${err.message}`);
    process.exit(1);
  }

  // 인덱스 처리
  const exists = await es.indices.exists({ index: INDEX_NAME });
  if (exists && FORCE_RECREATE) {
    await es.indices.delete({ index: INDEX_NAME });
    console.log(`✓ 기존 인덱스 삭제`);
  }
  if (!exists || FORCE_RECREATE) {
    await es.indices.create({ index: INDEX_NAME, ...INDEX_MAPPING });
    console.log(`✓ 인덱스 생성: ${INDEX_NAME}`);
    console.log(`  content → semantic_text (.jina-embeddings-v5-text-small)`);
  } else {
    console.log(`  인덱스 기존재 — 데이터 추가 모드 (재생성: --force)`);
  }

  // 카테고리 분포 미리보기
  console.log('\n  카테고리 분포 (예상):');
  for (const c of CATEGORY_WEIGHTS) {
    const expected = Math.round(TOTAL_DOCS * c.weight / 100);
    console.log(`    ${c.category.padEnd(12)} ~${expected.toLocaleString()}건`);
  }

  console.log('\n  색인 시작...\n');
  const startTime    = Date.now();
  let   totalIndexed = 0;
  let   totalErrors  = 0;

  for (let offset = 0; offset < TOTAL_DOCS; offset += CHUNK_SIZE) {
    const chunkCount = Math.min(CHUNK_SIZE, TOTAL_DOCS - offset);
    const operations = [];
    for (let i = 0; i < chunkCount; i++) {
      operations.push({ index: { _index: INDEX_NAME } });
      operations.push(generateDoc());
    }

    const result = await es.bulk({ operations, refresh: false });
    if (result.errors) {
      totalErrors += result.items.filter((it) => it.index?.error).length;
    }
    totalIndexed += chunkCount;
    printProgress(totalIndexed, TOTAL_DOCS, startTime);
  }

  // 최종 refresh
  process.stdout.write('\n\n  인덱스 refresh 중...\n');
  await es.indices.refresh({ index: INDEX_NAME });

  const elapsed  = ((Date.now() - startTime) / 1000).toFixed(1);
  const countRes = await es.count({ index: INDEX_NAME });

  console.log('\n' + '='.repeat(65));
  console.log(' 완료');
  console.log('='.repeat(65));
  console.log(`  색인 건수: ${totalIndexed.toLocaleString()}건`);
  console.log(`  실제 count: ${countRes.count.toLocaleString()}건`);
  console.log(`  오류: ${totalErrors}건`);
  console.log(`  소요: ${elapsed}초  /  평균: ${Math.round(totalIndexed / elapsed).toLocaleString()} docs/s`);
  console.log('='.repeat(65));
  if (totalErrors === 0) console.log('\n✓ 모든 문서가 성공적으로 색인되었습니다.');
}

main().catch((err) => {
  console.error('\n✗ 오류:', err.message);
  process.exit(1);
});
