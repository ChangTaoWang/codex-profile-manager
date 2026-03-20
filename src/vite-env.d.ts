/// <reference types="vite/client" />

import type { CodexApi } from '../shared/contracts';

declare global {
  interface Window {
    codexApi: CodexApi;
  }
}

export {};
