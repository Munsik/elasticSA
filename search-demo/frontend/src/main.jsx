import { init as initApm } from '@elastic/apm-rum';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// RUM Agent: 브라우저에서 APM Server로 직접 전송
// CORS 허용 설정은 Kibana > Fleet > APM Integration > RUM 설정에서
//   allow_origins: ["http://localhost:5173"] 으로 처리
initApm({
  serviceName:               import.meta.env.VITE_APM_SERVICE_NAME || 'search-demo-frontend',
  serverUrl:                 import.meta.env.VITE_APM_SERVER_URL,
  serviceVersion:            '1.0.0',
  environment:               import.meta.env.MODE,
  active:                    !!import.meta.env.VITE_APM_SERVER_URL,
  // 백엔드 APM과 분산 추적 연결 (프론트엔드 → 백엔드 트레이스 연결)
  distributedTracingOrigins: [import.meta.env.VITE_API_URL || 'http://localhost:3000'],
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
