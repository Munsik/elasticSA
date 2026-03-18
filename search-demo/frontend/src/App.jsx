import { withTransaction } from '@elastic/apm-rum-react';
import SearchPage from './pages/SearchPage';
import './index.css';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SearchPage />
    </div>
  );
}

export default withTransaction('App', 'component')(App);
