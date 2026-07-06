import {StrictMode, Component} from 'react';
import type {ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// After a deploy, hashed chunk files from the previous build stop existing;
// a tab that cached the old index.html then fails to load them and the app
// dies to a blank screen. Vite fires vite:preloadError for exactly this —
// reload once to pick up the new build (flag prevents a reload loop).
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('acc-reloaded')) return;
  sessionStorage.setItem('acc-reloaded', '1');
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem('acc-reloaded'));

// Last-resort boundary: a crash anywhere in the tree shows a readable
// message with a reload button instead of a blank white page.
class RootErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = {error: null as Error | null};

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#e2e8f0'}}>
        <div style={{maxWidth: 480, textAlign: 'center'}}>
          <h1 style={{fontSize: 20, marginBottom: 8}}>Something went wrong</h1>
          <p style={{fontSize: 14, opacity: 0.8, marginBottom: 6}}>
            Reloading usually fixes this (it picks up the latest version of the app).
          </p>
          <p style={{fontSize: 12, opacity: 0.55, marginBottom: 20, wordBreak: 'break-word'}}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{padding: '10px 24px', borderRadius: 8, border: 0, background: '#0284c7', color: '#fff', fontSize: 14, cursor: 'pointer'}}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
