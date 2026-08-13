import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/noto-sans-mono/400.css';
import 'katex/dist/katex.min.css';
import { App } from './App';
import { getMessages } from '../shared/messages';

const root = document.getElementById('root');
if (!root) throw new Error(getMessages('en').internal.rootNotFound);

/** Reactのルート要素へアプリケーション本体をStrictMode付きで描画する。 */
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
