import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { initTheme } from './utils/theme';

// Initialize theme immediately on load
initTheme();

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
