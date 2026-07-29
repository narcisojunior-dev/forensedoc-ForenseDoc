import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mocks para isolar dependências externas no teste de rota
vi.mock('../src/utils/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ping: vi.fn(),
    on: vi.fn(),
    disconnect: vi.fn(),
    call: vi.fn()
  }
}));

vi.mock('../src/utils/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    creditTransaction: { findMany: vi.fn() }
  }
}));

import creditRoutes from '../src/routes/creditRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/credits', creditRoutes);

describe('Credit Routes', () => {
  it('rejects unauthenticated requests to /api/credits/balance', async () => {
    const response = await request(app).get('/api/credits/balance');
    expect(response.status).toBe(401);
  });
});
