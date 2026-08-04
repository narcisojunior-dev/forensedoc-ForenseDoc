import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/*
 * O cleanup automático do testing-library depende dos globals do framework de
 * teste, e este projeto roda o vitest sem `globals: true`. Sem registrar aqui,
 * cada `render` permanecia no DOM depois do teste: consultas por role passavam
 * a encontrar elementos de testes anteriores e falhavam com "found multiple
 * elements", numa falha que parece do componente mas é de isolamento.
 */
afterEach(cleanup);

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
