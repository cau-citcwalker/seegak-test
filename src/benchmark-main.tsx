import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import BenchmarkPage from './pages/BenchmarkPage.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BenchmarkPage />
  </StrictMode>,
);
