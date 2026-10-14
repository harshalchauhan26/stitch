import http from './http.js';
import mock from './mock.js';

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
export const api = USE_MOCK ? mock : http;