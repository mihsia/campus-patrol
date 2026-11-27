import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register PWA Service Worker with automatic background update
registerSW({
  immediate: true,
  onRegisterError(error) {
    console.warn('PWA service worker registration skipped or failed:', error);
  },
});

createRoot(document.getElementById('root')!).render(<App />);
