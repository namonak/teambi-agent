import { ActivityHandler, CloudAdapter, loadPrevAuthConfigFromEnv } from '@microsoft/agents-hosting';
import { createMessageProcessor } from './message-processor.js';

export function isBotMention(activity) {
  const botId = activity?.recipient?.id;
  return Boolean(botId && activity?.entities?.some((entity) => entity.type === 'mention' && entity.mentioned?.id === botId));
}

export async function sendFollowUp(adapter, appId, reference, text) {
  await adapter.continueConversation(appId, reference, async (context) => {
    await context.sendActivity({ type: 'message', text, textFormat: 'markdown' });
  });
}

class TeambiBot extends ActivityHandler {
  constructor(adapter, appId) {
    super();
    const processMessage = createMessageProcessor();
    this.onMessage(async (context, next) => {
      if (!isBotMention(context.activity)) return next();
      context.activity.removeRecipientMention();
      const outcome = await processMessage(context.activity);
      await context.sendActivity({ type: 'message', text: outcome.reply, textFormat: 'markdown' });
      if (outcome.followUp) {
        const reference = context.activity.getConversationReference();
        outcome.followUp()
          .then((text) => sendFollowUp(adapter, appId, reference, text))
          .catch((e) => console.error('[teams-bot] 사후 응답 전송 실패:', e));
      }
      await next();
    });
  }
}

export function createTeamsBot() {
  const appId = process.env.MicrosoftAppId;
  if (!appId || !process.env.MicrosoftAppPassword) return null;
  const auth = loadPrevAuthConfigFromEnv();
  const adapter = new CloudAdapter(auth);
  return { auth, adapter, bot: new TeambiBot(adapter, appId) };
}

export function teamsMessagesHandler(teamsBot) {
  return async (request, response) => {
    await teamsBot.adapter.process(request, response, async (context) => teamsBot.bot.run(context));
  };
}
