import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isBotMention, sendFollowUp } from '../src/teams-bot.js';

test('자기 멘션이 있는 그룹 채팅 메시지만 처리한다', () => {
  const activity = {
    recipient: { id: 'bot-id' },
    entities: [
      { type: 'mention', mentioned: { id: 'bot-id' } },
      { type: 'mention', mentioned: { id: 'other-id' } },
    ],
  };

  assert.equal(isBotMention(activity), true);
  assert.equal(isBotMention({ ...activity, entities: [{ type: 'mention', mentioned: { id: 'other-id' } }] }), false);
  assert.equal(isBotMention({ recipient: { id: 'bot-id' } }), false);
});

test('자연어 처리 결과는 원래 그룹 채팅 참조로 사후 전송한다', async () => {
  const sent = [];
  const adapter = {
    async continueConversation(appId, reference, callback) {
      assert.equal(appId, 'app-id');
      assert.equal(reference.conversation.id, 'group-chat-id');
      await callback({ sendActivity: async (activity) => sent.push(activity) });
    },
  };

  await sendFollowUp(adapter, 'app-id', { conversation: { id: 'group-chat-id' } }, '✅ 처리했어요.');
  assert.deepEqual(sent, [{ type: 'message', text: '✅ 처리했어요.', textFormat: 'markdown' }]);
});
