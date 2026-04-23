import { useState, useRef, useEffect } from 'react';
import { Search, Zap, Database, Brain, Send, X, MessageSquare, ChevronDown, BarChart3, Star, Bug, AlertTriangle, CheckCircle } from 'lucide-react';
import { apm } from '@elastic/apm-rum';
import ReactMarkdown from 'react-markdown';
import { search, sendAnalyticsEvent } from '../api/search';

// =============================================================================
// 세션 ID 헬퍼 — 탭 단위로 유지 (sessionStorage 기반)
// Behavioral Analytics에서 동일 세션 내 검색 → 클릭 흐름을 추적하는 데 사용됩니다.
// =============================================================================
function getSessionId() {
  let sid = sessionStorage.getItem('ba_session_id');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('ba_session_id', sid);
  }
  return sid;
}

// =============================================================================
// PoV 추천 검색어 (오른쪽 사이드바에 표시)
// =============================================================================
const SUGGESTIONS = [
  '비밀번호가 만료되어 로그인이 안 돼요',        // Lexical 우세 — 정확한 키워드 일치
  '계정 보안을 강화하고 싶어요',                 // Vector 우세 — "MFA·비밀번호 정책" 의미론적 탐색
  '피싱 의심 메일을 받았을 때 대처 방법',        // Lexical 우세 — 키워드+보안 맥락 결합
  '신입사원이 첫날 해야 할 일 목록',             // Hybrid 우세 — FORK+FUSE+RERANK
  '연차 남은 일수 확인하고 반차 신청하는 방법',  // Lexical 우세 — 정확한 키워드 일치
  '보안 사고 발생 시 신고 절차와 예방 교육',     // 3-way 비교 추천 — 각 방식이 다른 문서를 반환
];

// 3-way 비교 모드에서 컬럼당 결과 수
const COMPARE_SIZE = 5;

// =============================================================================
// 검색 모드 설정
// =============================================================================
const SEARCH_MODES = [
  {
    id:          'lexical',
    label:       'Lexical',
    description: 'BM25 키워드 검색',
    icon:        Database,
    color:       'green',
    bgActive:    'bg-green-600 text-white border-green-600',
    bgHover:     'hover:border-green-400',
    badge:       'bg-green-100 text-green-700',
  },
  {
    id:          'vector',
    label:       'Vector',
    description: '의미론적 시맨틱 검색',
    icon:        Brain,
    color:       'purple',
    bgActive:    'bg-purple-600 text-white border-purple-600',
    bgHover:     'hover:border-purple-400',
    badge:       'bg-purple-100 text-purple-700',
  },
  {
    id:          'hybrid',
    label:       'Hybrid',
    description: 'BM25 + Semantic + RERANK',
    icon:        Zap,
    color:       'blue',
    bgActive:    'bg-blue-600 text-white border-blue-600',
    bgHover:     'hover:border-blue-400',
    badge:       'bg-blue-100 text-blue-700',
  },
  {
    id:          'compare',
    label:       '3-way 비교',
    description: '세 방식 동시 비교',
    icon:        BarChart3,
    color:       'orange',
    bgActive:    'bg-orange-600 text-white border-orange-600',
    bgHover:     'hover:border-orange-400',
    badge:       'bg-orange-100 text-orange-700',
  },
];

// 검색 모드별 스코어 바 색상
const MODE_BAR_COLOR = {
  lexical: 'bg-green-400',
  vector:  'bg-purple-400',
  hybrid:  'bg-blue-400',
};

// =============================================================================
// 스코어 시각화 바
// =============================================================================
function ScoreBar({ score, maxScore, colorClass = 'bg-blue-400' }) {
  const pct = maxScore > 0 ? Math.min(100, (score / maxScore) * 100) : 0;
  return (
    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// =============================================================================
// 검색 결과 카드
// lastQuery / searchType을 prop으로 받아 클릭 이벤트 전송에 활용합니다.
// =============================================================================
function ResultCard({ hit, index: idx, searchType, maxScore, lastQuery }) {
  const [expanded, setExpanded] = useState(false);

  const highlightTitle   = hit.highlight?.title?.[0];
  const highlightContent = hit.highlight?.content_text?.[0] ?? hit.highlight?.content?.[0];

  const contentPreview = hit.content
    ? (hit.content.length > 150 ? hit.content.slice(0, 150) + '…' : hit.content)
    : '';

  // ── Behavioral Analytics: click 이벤트 ──────────────────────────────────
  const handleCardClick = () => {
    sendAnalyticsEvent('click', {
      search: {
        query:       lastQuery,
        search_type: searchType,
      },
      document: {
        id:    hit.id ?? hit.title ?? String(idx),
        index: 'enterprise-knowledge',
      },
      page:    { current: 1 },
      session: { id: getSessionId() },
    });
  };
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={handleCardClick}
    >
      {/* 제목 + 스코어 */}
      <div className="flex justify-between items-start mb-1 gap-2">
        <h3
          className="font-semibold text-gray-900 leading-snug"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: highlightTitle || hit.title || '(제목 없음)' }}
        />
        <span className="text-xs text-gray-400 shrink-0 mt-0.5">
          #{idx + 1} · {hit.score?.toFixed(4)}
        </span>
      </div>

      {/* 스코어 바 */}
      <div className="mb-2">
        <ScoreBar
          score={hit.score ?? 0}
          maxScore={maxScore}
          colorClass={MODE_BAR_COLOR[searchType] ?? 'bg-blue-400'}
        />
      </div>

      {/* 메타 */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mb-2">
        {hit.category   && <span>{hit.category}</span>}
        {hit.department && <span>· {hit.department}</span>}
        {hit.author     && <span>· {hit.author}</span>}
        {hit.status     && <span>· {hit.status}</span>}
      </div>

      {/* 본문 미리보기 */}
      {highlightContent ? (
        <p
          className="text-sm text-gray-600"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: '…' + highlightContent + '…' }}
        />
      ) : (
        <>
          <p className="text-sm text-gray-600">
            {expanded ? hit.content : contentPreview}
          </p>
          {hit.content && hit.content.length > 150 && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="mt-1 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? '접기' : '더 보기'}
            </button>
          )}
        </>
      )}

      {/* hybrid: highlight 미지원 안내 */}
      {searchType === 'hybrid' && (
        <p className="mt-1 text-xs text-gray-400 italic">
          * Hybrid(ES|QL) 검색은 하이라이트를 지원하지 않습니다.
        </p>
      )}
    </div>
  );
}

// =============================================================================
// 3-way 비교용 컴팩트 카드
// commonLevel: 0 = 단독, 2 = 2가지 방식 공통 (amber), 3 = 3가지 모두 공통 (blue)
// =============================================================================
function CompareCard({ hit, commonLevel = 0, barColor, maxScore, lastQuery, colSearchType }) {
  const highlightTitle = hit.highlight?.title?.[0];
  const contentPreview = hit.content
    ? (hit.content.length > 100 ? hit.content.slice(0, 100) + '…' : hit.content)
    : '';

  const cardStyle =
    commonLevel === 3 ? 'border-blue-400 bg-blue-50' :
    commonLevel === 2 ? 'border-amber-400 bg-amber-50' :
    'bg-white border-gray-200';

  const starStyle =
    commonLevel === 3 ? 'text-blue-500 fill-blue-500' :
    'text-amber-500 fill-amber-500';

  // ── Behavioral Analytics: click 이벤트 (compare 모드) ───────────────────
  const handleCardClick = () => {
    sendAnalyticsEvent('click', {
      search: {
        query:       lastQuery,
        search_type: colSearchType,   // 어느 컬럼에서 클릭했는지 구분
      },
      document: {
        id:    hit.id ?? hit.title ?? '',
        index: 'enterprise-knowledge',
      },
      page:    { current: 1 },
      session: { id: getSessionId() },
    });
  };
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div
      className={`p-3 rounded-lg border text-sm hover:shadow-sm transition-shadow cursor-pointer ${cardStyle}`}
      onClick={handleCardClick}
    >
      <div className="flex justify-between items-start gap-1 mb-0.5">
        <h4
          className="font-medium text-gray-900 leading-snug text-xs flex-1"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: highlightTitle || hit.title || '(제목 없음)' }}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          {commonLevel >= 2 && <Star className={`w-3 h-3 ${starStyle}`} />}
          <span className="text-xs text-gray-400">{hit.score?.toFixed(3)}</span>
        </div>
      </div>

      {/* 스코어 바 */}
      <div className="mb-1.5">
        <ScoreBar score={hit.score ?? 0} maxScore={maxScore} colorClass={barColor} />
      </div>

      <p className="text-xs text-gray-500 leading-relaxed">{contentPreview}</p>
      {hit.category && (
        <span className="text-xs text-gray-400 mt-1 block">{hit.category}</span>
      )}
    </div>
  );
}

// =============================================================================
// 3-way 비교 뷰
// =============================================================================
function CompareView({ lexical, vector, hybrid, lastQuery }) {
  const titleSetCount = new Map();
  for (const titleSet of [
    new Set(lexical.map((h) => h.title)),
    new Set(vector.map((h)  => h.title)),
    new Set(hybrid.map((h)  => h.title)),
  ]) {
    for (const title of titleSet) {
      titleSetCount.set(title, (titleSetCount.get(title) ?? 0) + 1);
    }
  }

  const getCommonLevel = (title) => titleSetCount.get(title) ?? 0;

  const count3 = [...titleSetCount.values()].filter((c) => c === 3).length;
  const count2 = [...titleSetCount.values()].filter((c) => c === 2).length;

  const maxLex = lexical[0]?.score ?? 1;
  const maxVec = vector[0]?.score  ?? 1;
  const maxHyb = hybrid[0]?.score  ?? 1;

  const columns = [
    {
      key:        'lexical',
      label:      'Lexical (BM25)',
      hits:       lexical,
      maxScore:   maxLex,
      labelColor: 'text-green-700',
      headerBg:   'bg-green-50 border-green-200',
      barColor:   'bg-green-400',
    },
    {
      key:        'vector',
      label:      'Vector (Semantic / Jina v5)',
      hits:       vector,
      maxScore:   maxVec,
      labelColor: 'text-purple-700',
      headerBg:   'bg-purple-50 border-purple-200',
      barColor:   'bg-purple-400',
    },
    {
      key:        'hybrid',
      label:      'Hybrid (FORK+FUSE+RERANK)',
      hits:       hybrid,
      maxScore:   maxHyb,
      labelColor: 'text-blue-700',
      headerBg:   'bg-blue-50 border-blue-200',
      barColor:   'bg-blue-400',
    },
  ];

  return (
    <div>
      {/* 범례 */}
      {(count3 > 0 || count2 > 0) && (
        <div className="flex flex-wrap items-center gap-3 mb-3">
          {count3 > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-300 rounded-lg px-3 py-1.5">
              <Star className="w-3 h-3 fill-blue-500 text-blue-500" />
              <span><strong>{count3}개</strong> — 3가지 모두 공통 (파란색)</span>
            </div>
          )}
          {count2 > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              <span><strong>{count2}개</strong> — 2가지 방식 공통 (노란색)</span>
            </div>
          )}
        </div>
      )}

      {/* 3컬럼 */}
      <div className="grid grid-cols-3 gap-4">
        {columns.map((col) => (
          <div key={col.key}>
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-2 ${col.headerBg}`}>
              <span className={`text-xs font-semibold ${col.labelColor}`}>{col.label}</span>
              <span className="text-xs text-gray-400">{col.hits.length}건</span>
            </div>
            <div className="space-y-2">
              {col.hits.length === 0 ? (
                <p className="text-xs text-center text-gray-400 py-6">결과 없음</p>
              ) : col.hits.map((hit, i) => (
                <CompareCard
                  key={hit.id ?? hit.title ?? i}
                  hit={hit}
                  commonLevel={getCommonLevel(hit.title)}
                  barColor={col.barColor}
                  maxScore={col.maxScore}
                  lastQuery={lastQuery}
                  colSearchType={col.key}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// 카테고리 분포 패널
// =============================================================================
function FacetsPanel({ facets }) {
  if (!facets?.categories?.length) return null;
  const max = facets.categories[0]?.count ?? 1;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 mt-4">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        카테고리 분포
      </h2>
      <ul className="space-y-1.5">
        {facets.categories.map((cat) => (
          <li key={cat.key} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 w-20 truncate shrink-0">{cat.key}</span>
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-400 rounded-full"
                style={{ width: `${(cat.count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-5 text-right shrink-0">{cat.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// =============================================================================
// 에러 시뮬레이션 패널 (APM 에러 추적 데모)
// =============================================================================
const ERROR_SCENARIOS = [
  {
    id:         'frontend-js',
    label:      'JS 런타임 에러',
    desc:       'null 참조 TypeError — apm.captureError()로 즉시 전송',
  },
  {
    id:         'frontend-unhandled',
    label:      'Unhandled Promise Rejection',
    desc:       '처리되지 않은 Promise.reject — APM RUM 전역 핸들러가 자동 캡처',
  },
  {
    id:         'frontend-custom',
    label:      '커스텀 비즈니스 에러',
    desc:       '검색 실패 시나리오 — 에러 타입·메시지를 직접 지정해 캡처',
  },
];

function ErrorTestPanel() {
  const [open,    setOpen]    = useState(false);
  const [result,  setResult]  = useState(null);
  const [running, setRunning] = useState(null);

  const run = (scenario) => {
    setRunning(scenario.id);
    setResult(null);

    try {
      if (scenario.id === 'frontend-js') {
        const err = new TypeError(
          `[APM 테스트] null 역참조 TypeError — ${new Date().toISOString()}`
        );
        apm.captureError(err);
        setResult({ ok: true, message: `TypeError 캡처 완료 → Kibana APM > Errors 에서 확인` });
        return;
      }

      if (scenario.id === 'frontend-unhandled') {
        Promise.reject(
          new Error(`[APM 테스트] Unhandled Promise Rejection — ${new Date().toISOString()}`)
        );
        setResult({ ok: true, message: `Unhandled rejection 발생 → APM RUM 자동 캡처` });
        return;
      }

      if (scenario.id === 'frontend-custom') {
        const err = new Error(
          `[APM 테스트] 검색 서비스 일시 불가 — ${new Date().toISOString()}`
        );
        err.name = 'SearchServiceError';
        apm.captureError(err, {
          custom: { scenario: 'search-unavailable', simulated: true },
        });
        setResult({ ok: true, message: `커스텀 에러 캡처 완료 → error.type: SearchServiceError` });
        return;
      }

    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); setResult(null); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
          open
            ? 'bg-red-600 text-white border-red-600'
            : 'bg-white text-red-600 border-red-300 hover:border-red-500'
        }`}
      >
        <Bug className="w-3.5 h-3.5" />
        에러 시뮬레이션
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-semibold text-red-700">APM 에러 추적 데모</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="px-4 pt-3 pb-1 text-xs text-gray-500">
            프론트엔드 에러를 발생시켜 Kibana APM &gt; <strong>search-demo-frontend</strong> &gt; Errors에서 확인하세요.
          </p>

          {/* 시나리오 목록 */}
          <ul className="px-3 py-2 space-y-1">
            {ERROR_SCENARIOS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => run(s)}
                  disabled={!!running}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 group"
                >
                  <span className="text-sm font-medium text-gray-800 group-hover:text-red-700 block">
                    {s.label}
                  </span>
                  <p className="text-xs text-gray-400 mt-0.5">{s.desc}</p>
                  {running === s.id && (
                    <p className="text-xs text-blue-500 mt-0.5 animate-pulse">실행 중…</p>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* 결과 */}
          {result && (
            <div className={`mx-3 mb-3 p-2.5 rounded-lg text-xs flex items-start gap-2 ${
              result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              <CheckCircle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${result.ok ? 'text-green-500' : 'text-red-500'}`} />
              <span>{result.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 챗봇 패널
// =============================================================================
function ChatPanel({ onClose }) {
  const [messages, setMessages]             = useState([
    { role: 'assistant', text: '안녕하세요! 사내 지식 검색 AI 어시스턴트입니다. 무엇이든 물어보세요.' },
  ]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setLoading(true);

    const tx = apm.startTransaction('Chat:send', 'user-interaction');
    tx?.addLabels({ is_followup: !!conversationId, input_length: text.length });

    setMessages((prev) => [...prev, { role: 'assistant', text: '', streaming: true }]);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input: text, conversation_id: conversationId }),
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop();

        for (const block of blocks) {
          const eventMatch = block.match(/^event:\s*(\w+)/m);
          const dataMatch  = block.match(/^data:\s*(.+)/m);
          if (!dataMatch) continue;

          const event = eventMatch?.[1] ?? 'message';
          let data;
          try { data = JSON.parse(dataMatch[1]); } catch { continue; }

          if (event === 'chunk') {
            setMessages((prev) => {
              const next = [...prev];
              const last = { ...next[next.length - 1] };
              if (last?.streaming) last.text += data.text;
              next[next.length - 1] = last;
              return next;
            });
          } else if (event === 'done') {
            if (data.conversation_id) setConversationId(data.conversation_id);
            setMessages((prev) => {
              const next = [...prev];
              const last = { ...next[next.length - 1] };
              if (last?.streaming) last.streaming = false;
              next[next.length - 1] = last;
              return next;
            });
          } else if (event === 'error') {
            setMessages((prev) => {
              const next = [...prev];
              const last = { ...next[next.length - 1] };
              if (last?.streaming) {
                last.text      = `오류: ${data.message}`;
                last.streaming = false;
                last.error     = true;
              }
              next[next.length - 1] = last;
              return next;
            });
          }
        }
      }
    } catch (err) {
      apm.captureError(err);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) {
          last.text      = `연결 오류: ${err.message}`;
          last.streaming = false;
          last.error     = true;
        }
        return next;
      });
    } finally {
      setLoading(false);
      tx?.end();
    }
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 h-[560px] bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col z-50">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-blue-600 rounded-t-xl">
        <div className="flex items-center gap-2 text-white">
          <MessageSquare className="w-4 h-4" />
          <span className="font-medium text-sm">AI 어시스턴트</span>
        </div>
        <button onClick={onClose} className="text-blue-200 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : msg.error
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.role === 'user' ? (
                <span className="whitespace-pre-wrap">{msg.text}</span>
              ) : (
                <div className="prose prose-sm prose-gray max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1 prose-pre:my-1 prose-code:text-xs prose-code:bg-gray-200 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-700 prose-pre:text-gray-100">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              )}
              {msg.streaming && <span className="animate-pulse ml-1">▋</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="메시지를 입력하세요..."
            disabled={loading}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// 추천 검색어 사이드바
// =============================================================================
const SUGGESTION_HINTS = [
  { label: 'Lexical 유리',    color: 'text-green-700 bg-green-100' },
  { label: 'Vector 유리',     color: 'text-purple-700 bg-purple-100' },
  { label: 'Lexical 유리',    color: 'text-green-700 bg-green-100' },
  { label: 'Hybrid 유리',     color: 'text-blue-700 bg-blue-100' },
  { label: 'Lexical 유리',    color: 'text-green-700 bg-green-100' },
  { label: '3-way 비교 추천', color: 'text-orange-700 bg-orange-100' },
];

function SuggestionsPanel({ onSelect }) {
  return (
    <aside className="w-full">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
          추천 검색어
        </h2>
        <p className="text-xs text-gray-400 mb-3">클릭하면 검색이 실행됩니다</p>
        <ul className="space-y-2">
          {SUGGESTIONS.map((s, i) => {
            const hint = SUGGESTION_HINTS[i];
            return (
              <li key={s}>
                <button
                  onClick={() => onSelect(s)}
                  className="w-full text-left rounded-lg px-3 py-2 hover:bg-blue-50 transition-colors group"
                >
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded mr-1.5 ${hint.color}`}>
                    {hint.label}
                  </span>
                  <span className="text-sm text-gray-700 group-hover:text-blue-600 leading-snug">
                    {s}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

// =============================================================================
// 메인 SearchPage
// =============================================================================
export default function SearchPage() {
  const [query,          setQuery]          = useState('');
  const [searchType,     setSearchType]     = useState('hybrid');
  const [results,        setResults]        = useState(null);
  const [compareResults, setCompareResults] = useState(null);
  const [facets,         setFacets]         = useState(null);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [showChat,       setShowChat]       = useState(false);

  // ── lastQuery: ResultCard / CompareCard의 click 이벤트에서 검색어를 참조하기 위해 별도 보관
  const [lastQuery, setLastQuery] = useState('');

  const currentMode = SEARCH_MODES.find((m) => m.id === searchType);
  const isCompare   = searchType === 'compare';

  // ── 실제 검색 로직 ──────────────────────────────────────────────────────────
  const doSearch = async (q, type) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setCompareResults(null);
    setFacets(null);
    setLastQuery(q);   // click 이벤트에서 사용

    // ── 3-way 비교 모드 ──
    if (type === 'compare') {
      const tx = apm.startTransaction('Search:compare', 'user-interaction');
      tx?.addLabels({ query: q.slice(0, 100) });
      try {
        const [lex, vec, hyb] = await Promise.all([
          search(q, 'lexical', 'enterprise-knowledge', COMPARE_SIZE),
          search(q, 'vector',  'enterprise-knowledge', COMPARE_SIZE),
          search(q, 'hybrid',  'enterprise-knowledge', COMPARE_SIZE),
        ]);

        // ── Behavioral Analytics: compare 모드 search 이벤트 (3건 병렬 전송) ──
        const sid = getSessionId();
        ['lexical', 'vector', 'hybrid'].forEach((st, i) => {
          const data = [lex, vec, hyb][i];
          sendAnalyticsEvent('search', {
            search: {
              query:        q,
              search_type:  st,
              results: {
                total_results: data.total ?? 0,
                items: (data.hits ?? []).slice(0, 5).map((hit) => ({
                  document: { id: hit.id ?? hit.title, index: 'enterprise-knowledge' },
                  page:     { current: 1 },
                })),
              },
            },
            session: { id: sid },
          });
        });
        // ────────────────────────────────────────────────────────────────────

        setCompareResults({ lexical: lex.hits, vector: vec.hits, hybrid: hyb.hits });
        tx?.addLabels({
          lex_count: lex.hits.length,
          vec_count: vec.hits.length,
          hyb_count: hyb.hits.length,
        });
      } catch (err) {
        apm.captureError(err);
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
        tx?.end();
      }
      return;
    }

    // ── 단일 검색 모드 ──
    const tx = apm.startTransaction(`Search:${type}`, 'user-interaction');
    tx?.addLabels({ search_type: type, query: q.slice(0, 100) });
    try {
      const data = await search(q, type, 'enterprise-knowledge', 10);
      setResults(data);
      setFacets(data.facets ?? null);
      tx?.addLabels({ result_count: data.hits?.length ?? 0, took_ms: data.took ?? 0 });

      // ── Behavioral Analytics: search 이벤트 ──────────────────────────────
      sendAnalyticsEvent('search', {
        search: {
          query:        q,
          search_type:  type,
          results: {
            total_results: data.total ?? 0,
            items: (data.hits ?? []).slice(0, 5).map((hit) => ({
              document: { id: hit.id ?? hit.title, index: 'enterprise-knowledge' },
              page:     { current: 1 },
            })),
          },
        },
        session: { id: getSessionId() },
      });
      // ────────────────────────────────────────────────────────────────────

    } catch (err) {
      apm.captureError(err);
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
      tx?.end();
    }
  };

  const handleSearch = (e) => {
    e?.preventDefault();
    doSearch(query, searchType);
  };

  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion);
    doSearch(suggestion, searchType);
  };

  const maxScore = results?.hits?.[0]?.score ?? 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className={`${isCompare ? 'max-w-7xl' : 'max-w-6xl'} mx-auto px-4 py-10`}>

        {/* ── 헤더 ── */}
        <div className="relative text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">
            Enterprise Knowledge Search
          </h1>
          <p className="text-gray-500 text-sm">
            Elastic Hybrid Search Demo · BM25 + Jina v5 Semantic + RERANK
          </p>
          <div className="absolute top-0 right-0">
            <ErrorTestPanel />
          </div>
        </div>

        {/* ── 레이아웃: 검색 영역 + 사이드바 ── */}
        <div className="flex gap-6 items-start">

          {/* ── 왼쪽: 검색폼 + 결과 ── */}
          <div className="flex-1 min-w-0">
            <form onSubmit={handleSearch} className="mb-4">
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="검색어를 입력하세요 (예: 비밀번호 재설정, VPN 설치 방법)"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium shadow-sm"
                >
                  {loading ? '검색 중…' : '검색'}
                </button>
              </div>

              {/* ── 검색 모드 토글 ── */}
              <div className="flex gap-2 flex-wrap">
                {SEARCH_MODES.map((mode) => {
                  const Icon   = mode.icon;
                  const active = searchType === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        setSearchType(mode.id);
                        setResults(null);
                        setCompareResults(null);
                        setFacets(null);
                        setError(null);
                      }}
                      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        active
                          ? mode.bgActive
                          : `text-gray-600 border-gray-300 bg-white ${mode.bgHover}`
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {mode.label}
                      <span className={`text-xs hidden sm:inline ${active ? 'opacity-80' : 'text-gray-400'}`}>
                        — {mode.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </form>

            {/* ── 에러 ── */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* ── 3-way 비교 결과 ── */}
            {compareResults && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-gray-500">3가지 검색 방식 비교 결과</p>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                    3-way 비교
                  </span>
                </div>
                <CompareView
                  lexical={compareResults.lexical}
                  vector={compareResults.vector}
                  hybrid={compareResults.hybrid}
                  lastQuery={lastQuery}
                />
              </div>
            )}

            {/* ── 단일 검색 결과 ── */}
            {results && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-gray-500">
                    <span className="font-semibold text-gray-800">{results.total}</span>개 결과
                    {results.took != null && (
                      <span className="ml-2 text-gray-400">· {results.took}ms</span>
                    )}
                  </p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${currentMode?.badge}`}>
                    {currentMode?.label} Search
                  </span>
                </div>

                {results.hits.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">검색 결과가 없습니다.</div>
                ) : (
                  <div className="space-y-3">
                    {results.hits.map((hit, i) => (
                      <ResultCard
                        key={hit.id ?? hit.title ?? i}
                        hit={hit}
                        index={i}
                        searchType={searchType}
                        maxScore={maxScore}
                        lastQuery={lastQuery}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 초기 안내 ── */}
            {!results && !compareResults && !loading && !error && (
              <div className="text-center py-16 text-gray-400">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">검색어를 입력하고 검색 방식을 선택하세요.</p>
                <p className="text-xs mt-1">
                  3-way 비교 모드로 Lexical / Vector / Hybrid 결과를 한눈에 비교할 수 있습니다.
                </p>
              </div>
            )}
          </div>

          {/* ── 오른쪽: 사이드바 (항상 표시) ── */}
          <aside className="hidden lg:block w-56 shrink-0">
            <SuggestionsPanel onSelect={handleSuggestionClick} />
            <FacetsPanel facets={facets} />
          </aside>
        </div>
      </div>

      {/* ── 챗봇 FAB ── */}
      {!showChat && (
        <button
          onClick={() => setShowChat(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center"
          title="AI 어시스턴트 열기"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}

      {/* ── 챗봇 패널 ── */}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} />}
    </div>
  );
}
