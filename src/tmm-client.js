// tmm-client.js — teamMoneyManager REST 클라이언트.
// 공유 비밀번호로 로그인해 세션 쿠키를 유지하고, 401이면 1회 재로그인 후 재시도한다.
const BASE = () => (process.env.TMM_BASE_URL || '').replace(/\/$/, '');

let sessionCookie = null;

async function login() {
  if (!BASE() || !process.env.TMM_PASSWORD) {
    throw new Error('TMM_BASE_URL / TMM_PASSWORD 환경변수가 설정되지 않았습니다');
  }
  const res = await fetch(`${BASE()}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.TMM_PASSWORD }),
  });
  if (!res.ok) throw new Error(`teamMoneyManager 로그인 실패 (HTTP ${res.status})`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  const session = cookies.find((c) => c.startsWith('session='));
  if (!session) throw new Error('로그인 응답에 세션 쿠키가 없습니다');
  sessionCookie = session.split(';')[0];
}

async function api(method, path, body, retry = true) {
  if (!sessionCookie) await login();
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry) {
    sessionCookie = null; // 세션 만료 → 재로그인 후 1회 재시도
    return api(method, path, body, false);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(json?.error || `teamMoneyManager API 오류 (HTTP ${res.status})`);
    err.status = res.status;
    err.code = json?.error;
    throw err;
  }
  return json;
}

// --- 조회 ---
export const getCategories = (period) => api('GET', `/api/periods/${period}/categories`); // {categories:[{id,name,amount}]}
export const getMembers = () => api('GET', '/api/members');
export const getDashboard = (period) => api('GET', `/api/dashboard?period=${encodeURIComponent(period)}`); // {categories:[{id,name,allocated,used,remaining}],...}
export const listTransactions = (params = {}) =>
  api('GET', `/api/transactions?${new URLSearchParams(params)}`); // {period, transactions:[...]}

// --- 기입/편집 ---
export const createTransaction = (body) => api('POST', '/api/transactions', body); // {ok, transaction}
export const updateTransaction = (id, body) => api('PUT', `/api/transactions/${id}`, body);
export const deleteTransaction = (id) => api('DELETE', `/api/transactions/${id}`);
