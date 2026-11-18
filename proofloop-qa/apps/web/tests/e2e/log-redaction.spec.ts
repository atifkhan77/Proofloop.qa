import http from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { expect, test } from '@playwright/test';
import { describeError } from '../../../api/src/utils/redact';

/**
 * Regression: integration.service logged the raw axios error when a Jira push failed, which
 * printed the Authorization header (Basic base64(email:apiToken)) to the server log.
 * Pure function test: no app servers involved.
 */

const EMAIL = 'jira-bot@example.com';
const TOKEN = 'regression-secret-jira-token';
const BASIC = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

let server: http.Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errorMessage: 'Site temporarily unavailable', errorCode: 'OTHER' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('describeError: axios error summary keeps status and response, drops credentials', async () => {
  // Arrange
  const err = await axios
    .post(`${baseUrl}/rest/api/2/issue`, { fields: {} }, { headers: { Authorization: `Basic ${BASIC}` } })
    .catch((e: unknown) => e);
  expect(axios.isAxiosError(err)).toBe(true);

  // Act
  const summary = describeError(err);

  // Assert
  expect(summary).toContain('status 404');
  expect(summary).toContain('Site temporarily unavailable');
  expect(summary).not.toContain(BASIC);
  expect(summary).not.toContain(TOKEN);
  expect(summary).not.toContain('Authorization');
});

test('describeError: non-axios errors and non-objects', () => {
  // Arrange
  const plain = new TypeError('boom');

  // Act
  const fromError = describeError(plain);
  const fromString = describeError('just text');

  // Assert
  expect(fromError).toBe('TypeError: boom');
  expect(fromString).toBe('just text');
});
