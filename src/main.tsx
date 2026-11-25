import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

async function bootstrap() {
  try {
    const { startMocks } = await import('./mocks/browser');
    await startMocks();
  } catch (e) {
    // Mocks unavailable (e.g. no Service Worker support): the game still works,
    // ranking/history show their error state.
    console.warn('[mocks] could not start the mock API', e);
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
