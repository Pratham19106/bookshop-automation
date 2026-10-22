import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './index.css';
import App from './App';
import { AuthProvider } from './lib/auth';
import { Overlays } from './lib/overlays';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* reducedMotion="user": people who ask their OS for less motion get none */}
    <MotionConfig reducedMotion="user">
      <HashRouter>
        <AuthProvider>
          <App />
          <Overlays />
        </AuthProvider>
      </HashRouter>
    </MotionConfig>
  </React.StrictMode>,
);
