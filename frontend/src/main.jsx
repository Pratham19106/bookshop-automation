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
import { ShopProvider } from './lib/shop';
import { Overlays } from './lib/overlays';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* reducedMotion="user": people who ask their OS for less motion get none */}
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <AuthProvider>
            <ShopProvider>
              <App />
              <Overlays />
            </ShopProvider>
          </AuthProvider>
        </HashRouter>
      </QueryClientProvider>
    </MotionConfig>
  </React.StrictMode>,
);
