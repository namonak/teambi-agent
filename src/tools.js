// tools.js — 자연어 처리용 LLM 도구 6종. 모든 실행은 tmm-client(REST) 위임.
// 도구 실행 결과는 tool_result 문자열로 반환하고, 기입/수정/삭제는 sideEffects에 기록해
// 타임아웃 시에도 "지금까지 처리된 것"을 정직하게 회신할 수 있게 한다.
import * as tmm from './tmm-client.js';
import { currentPeriod, todayStr, fmtWon, cardLabel } from './util.js';

const TOOL_DEFS = [
  {
    name: 'list_categories',
    description: '당월 공용 카테고리 목록과 예산/사용액/잔액을 조회한다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_members',
    description: '활성 팀원 목록(id, 이름)을 조회한다. 개인 지출 기입 시 대상 특정에 사용.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_recent_transactions',
    description: '당월 지출 내역을 최신순으로 조회한다. 수정/삭제 대상을 특정할 때 반드시 먼저 호출한다.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '최대 건수 (기본 10, 최대 20)' },
        kind: { type: 'string', enum: ['common', 'personal'], description: '지출 종류 필터' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_transaction',
    description: '지출 1건을 기입한다. 공용(common)은 category_name, 개인(personal)은 member_name이 필요하다.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. 생략하면 오늘. 당월만 가능.' },
        amount: { type: 'integer', description: '금액(원), 양의 정수' },
        kind: { type: 'string', enum: ['common', 'personal'] },
        category_name: { type: 'string', description: '공용 카테고리 이름 (예: 커피, 회식)' },
        member_name: { type: 'string', description: '개인 지출 대상 팀원 이름' },
        card: { type: 'integer', enum: [1, 2], description: '사용 카드 (모르면 생략)' },
        memo: { type: 'string', description: '메모 (가맹점명 등)' },
      },
      required: ['amount', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_transaction',
    description: '기존 지출을 수정한다. list_recent_transactions로 id를 특정한 뒤에만 호출한다. 지정한 필드만 변경된다.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '수정할 지출 id' },
        date: { type: 'string' },
        amount: { type: 'integer' },
        kind: { type: 'string', enum: ['common', 'personal'] },
        category_name: { type: 'string' },
        member_name: { type: 'string' },
        card: { type: 'integer', enum: [1, 2] },
        memo: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_transaction',
    description: '지출 1건을 삭제한다. list_recent_transactions로 id를 특정한 뒤에만 호출한다.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer', description: '삭제할 지출 id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// 이름 → id 해석 (정확 일치 → 부분 일치, 모호하면 에러)
function resolveByName(list, name, label) {
  const exact = list.filter((x) => x.name === name);
  const partial = exact.length > 0 ? exact : list.filter((x) => x.name.includes(name) || name.includes(x.name));
  if (partial.length === 1) return partial[0];
  if (partial.length === 0) throw new Error(`${label} '${name}'을(를) 찾을 수 없음. 후보: ${list.map((x) => x.name).join(', ')}`);
  throw new Error(`${label} '${name}'이(가) 모호함. 후보: ${partial.map((x) => x.name).join(', ')}`);
}

export async function createToolkit() {
  const period = currentPeriod();
  // 시스템 프롬프트 선주입용 + 이름 해석용으로 미리 로드
  const [dashboard, membersRes] = await Promise.all([tmm.getDashboard(period), tmm.getMembers()]);
  const categories = dashboard.categories ?? [];
  const allMembers = membersRes.members ?? membersRes ?? [];
  const members = allMembers.filter((m) => m.active !== 0);
  const sideEffects = []; // {action, id, summary}

  async function findTx(id) {
    const { transactions } = await tmm.listTransactions({ period });
    const tx = transactions.find((t) => t.id === id);
    if (!tx) throw new Error(`당월 지출에서 id=${id}를 찾을 수 없음`);
    return tx;
  }

  function buildBody(input, base = {}) {
    const body = {
      date: input.date ?? base.date ?? todayStr(),
      amount: input.amount ?? base.amount,
      kind: input.kind ?? base.kind,
      card: input.card ?? base.card ?? null,
      memo: input.memo ?? base.memo ?? null,
      period_category_id: base.period_category_id ?? null,
      member_id: base.member_id ?? null,
    };
    if (input.category_name) {
      body.kind = input.kind ?? 'common';
      body.period_category_id = resolveByName(categories, input.category_name, '카테고리').id;
      body.member_id = null;
    }
    if (input.member_name) {
      body.kind = input.kind ?? 'personal';
      body.member_id = resolveByName(members, input.member_name, '팀원').id;
      body.period_category_id = null;
    }
    if (body.kind === 'common') body.member_id = null;
    if (body.kind === 'personal') body.period_category_id = null;
    return body;
  }

  const summarize = (tx) =>
    `#${tx.id} ${tx.date} ${fmtWon(tx.amount)} ${tx.kind === 'common' ? (tx.category_name ?? '공용') : `개인(${tx.member_name ?? ''})`} ${cardLabel(tx.card)}${tx.memo ? ` · ${tx.memo}` : ''}`;

  async function run(name, input) {
    try {
      switch (name) {
        case 'list_categories': {
          const d = await tmm.getDashboard(period);
          return { content: JSON.stringify(d.categories ?? [], null, 0), is_error: false };
        }
        case 'list_members':
          return { content: JSON.stringify(members.map((m) => ({ id: m.id, name: m.name }))), is_error: false };
        case 'list_recent_transactions': {
          const params = { period };
          if (input.kind) params.kind = input.kind;
          const { transactions } = await tmm.listTransactions(params);
          const limit = Math.min(input.limit ?? 10, 20);
          return { content: JSON.stringify(transactions.slice(0, limit)), is_error: false };
        }
        case 'create_transaction': {
          const body = buildBody(input);
          const { transaction } = await tmm.createTransaction(body);
          const summary = summarize({ ...transaction, category_name: categories.find((c) => c.id === transaction.period_category_id)?.name, member_name: members.find((m) => m.id === transaction.member_id)?.name });
          sideEffects.push({ action: '등록', summary });
          return { content: `기입 완료: ${summary}`, is_error: false };
        }
        case 'update_transaction': {
          const before = await findTx(input.id);
          const body = buildBody(input, before);
          const { transaction } = await tmm.updateTransaction(input.id, body);
          const summary = summarize({ ...transaction, category_name: categories.find((c) => c.id === transaction.period_category_id)?.name, member_name: members.find((m) => m.id === transaction.member_id)?.name });
          sideEffects.push({ action: '수정', summary });
          return { content: `수정 완료: ${summary}`, is_error: false };
        }
        case 'delete_transaction': {
          const before = await findTx(input.id);
          await tmm.deleteTransaction(input.id);
          const summary = summarize(before);
          sideEffects.push({ action: '삭제', summary });
          return { content: `삭제 완료: ${summary}`, is_error: false };
        }
        default:
          return { content: `알 수 없는 도구: ${name}`, is_error: true };
      }
    } catch (e) {
      if (e.status) return { content: `외부 서비스 처리 중 오류가 발생했어요 (HTTP ${e.status})`, is_error: true };
      return { content: `오류: ${e.message}`, is_error: true };
    }
  }

  return { tools: TOOL_DEFS, run, sideEffects, categories, members, period };
}
