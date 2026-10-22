import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/700.css';
import './index.css';
import App from './App';
import { AuthProvider } from './lib/auth';
import { Overlays } from './lib/overlays';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
        <Overlays />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
