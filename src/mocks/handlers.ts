import { delay, http, HttpResponse } from 'msw';
import type { ApiErrorBody, CreateMatchResponse, MatchRecord } from '../api/contracts';
import { findMatch, insertMatch, queryHistory, queryRanking } from './db';
import { getScenario, HANG_MS, nextLatency, type ScenarioId } from './scenarios';

/** Shared MSW handlers: used by the browser worker in dev, preview, production and Playwright. */

type Endpoint = 'ranking' | 'history' | 'create';

function error(status: number, code: string, message: string) {
  return HttpResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
}

/** Returns a failure response for the active scenario, or null to continue normally. */
function scenarioFailure(scenario: ScenarioId, endpoint: Endpoint) {
  switch (scenario) {
    case 'network-error':
      return HttpResponse.error();
    case 'server-error':
      return error(500, 'internal_error', 'Simulated server error.');
    case 'client-error':
      return endpoint === 'create'
        ? error(400, 'bad_request', 'Simulated validation error.')
        : error(404, 'not_found', 'Simulated missing resource.');
    case 'ranking-failure':
      return endpoint === 'ranking' ? error(500, 'internal_error', 'Ranking service unavailable.') : null;
    case 'history-failure':
      return endpoint === 'history' ? error(500, 'internal_error', 'History service unavailable.') : null;
    case 'write-unavailable':
      return endpoint === 'create' ? error(503, 'unavailable', 'Match service temporarily unavailable.') : null;
    default:
      return null;
  }
}

function intParam(url: URL, name: string, fallback: number): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isValidRecord(r: Partial<MatchRecord> | null): r is MatchRecord {
  return (
    !!r &&
    typeof r.matchId === 'string' &&
    r.matchId.length > 0 &&
    typeof r.playerId === 'string' &&
    typeof r.playerName === 'string' &&
    typeof r.playedAt === 'string' &&
    Number.isInteger(r.score) &&
    (r.score ?? -1) >= 0 &&
    typeof r.durationSeconds === 'number' &&
    (r.endReason === 'time_up' || r.endReason === 'destroyed') &&
    !!r.config &&
    typeof r.config.configKey === 'string'
  );
}

export const handlers = [
  http.get('*/api/ranking', async ({ request }) => {
    const scenario = getScenario();
    await delay(nextLatency(scenario));
    const fail = scenarioFailure(scenario, 'ranking');
    if (fail) return fail;
    const url = new URL(request.url);
    const configKey = url.searchParams.get('configKey');
    const page = intParam(url, 'page', 1);
    const pageSize = intParam(url, 'pageSize', 10);
    if (!configKey || !page || !pageSize || pageSize > 50) return error(400, 'bad_request', 'Invalid query.');
    if (scenario === 'empty') return HttpResponse.json({ items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 });
    return HttpResponse.json(queryRanking(configKey, page, pageSize));
  }),

  http.get('*/api/players/:playerId/matches', async ({ request, params }) => {
    const scenario = getScenario();
    await delay(nextLatency(scenario));
    const fail = scenarioFailure(scenario, 'history');
    if (fail) return fail;
    const url = new URL(request.url);
    const page = intParam(url, 'page', 1);
    const pageSize = intParam(url, 'pageSize', 10);
    if (!page || !pageSize || pageSize > 50) return error(400, 'bad_request', 'Invalid query.');
    if (scenario === 'empty') return HttpResponse.json({ items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 });
    return HttpResponse.json(queryHistory(String(params.playerId), page, pageSize));
  }),

  http.post('*/api/matches', async ({ request }) => {
    const scenario = getScenario();
    const body = (await request.json().catch(() => null)) as Partial<MatchRecord> | null;
    if (scenario === 'write-timeout') {
      // The write is committed, but the client never sees the answer in time.
      if (isValidRecord(body)) insertMatch(body);
      await delay(HANG_MS);
      return HttpResponse.json<CreateMatchResponse>({ record: findMatch(body?.matchId ?? '')!, created: true });
    }
    await delay(nextLatency(scenario));
    const fail = scenarioFailure(scenario, 'create');
    if (fail) return fail;
    if (!isValidRecord(body)) return error(400, 'bad_request', 'Invalid match record.');
    const result = insertMatch(body);
    return HttpResponse.json<CreateMatchResponse>(result, { status: result.created ? 201 : 200 });
  }),
];
