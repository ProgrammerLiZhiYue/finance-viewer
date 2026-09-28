import './index.css';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App';
import i18n from './i18n';
import { SettingsProvider } from './context/SettingsContext';

createRoot(document.getElementById('app')!).render(
  <I18nextProvider i18n={i18n}>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </I18nextProvider>,
);

console.log(
  '👋 This message is being logged by "renderer.tsx", included via Vite',
);
