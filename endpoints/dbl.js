const { addLootbox, sendNotification, mongo } = require('../db');
const { logErrors } = require('../util');
const recentlyReceived = new Set();
const { StatsD } = require('node-dogstatsd');
const ddog = new StatsD();

module.exports = (app, config) =>
  app.post('/dblwebhook', async (req, res) => {
    if (
      !req.headers.authorization ||
      req.headers.authorization !== config.dblorg_webhook_secret
    ) {
      return res.status(401).send({ status: 401 });
    }

    const body = JSON.parse(req.body);

    if (body.type !== 'upvote') {
      res.status(400).send({ status: 400, message: `Unknown type ${body.type}` });
      return logErrors(new Error(`[DBL Webhook] Unknown payload type "${body.type}"`));
    }

    if (body.isWeekend) {
      ddog.increment(`webhooks.topgg.memer`);
      await addLootbox(body.user, 'meme', 3, true);
      await sendNotification(body.user, 'vote', 'Thank you for voting!', 'You just got your **`3 meme boxes`** for voting on top.gg! Come back and do it again in 12 hours!');
    } else {
      ddog.increment(`webhooks.topgg.memer`);
      await addLootbox(body.user, 'meme', 2, true);
      await sendNotification(body.user, 'vote', 'Thank you for voting!', 'You just got your **`2 meme boxes`** for voting on top.gg! Come back and do it again in 12 hours!');
    }

    res.status(200).send({ status: 200 });
  });
