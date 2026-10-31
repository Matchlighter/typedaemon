import { createRoot } from 'react-dom/client';
import { App } from './App';
// Self-hosted fonts (latin subset; no CDN: dashboard must work offline / in HA ingress). Weights match the mocks'
// Google Fonts request (Roboto 400/500/700, Roboto Mono 400/500); CSS weight 600 resolves to 700 as in the mocks.
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-500.css';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(<App />);
