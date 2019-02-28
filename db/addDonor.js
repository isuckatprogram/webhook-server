const { sendWebhook } = require('../util');
const r = require('./r.js');
const _saveQuery = require('./_saveQuery.js');
const _fetchUserQuery = require('./_fetchUserQuery.js');

module.exports = async function addDonor (body) {
  const user = body.included.find(inc => inc.type === 'user');
  const discordID = user.attributes.social_connections &&
    user.attributes.social_connections.discord &&
    user.attributes.social_connections.discord.user_id;

  const { attributes } = body.data;
  if (attributes.currently_entitled_amount_cents === 0) {
    return;
  }

  sendWebhook({
    title: 'Pledge Create',
    color: 0x71f23e,
    fields: [ {
      name: 'Amount Pledged',
      value: `$${attributes.currently_entitled_amount_cents / 100}`
    } ],
    user,
    discordID
  });

  if (discordID) {
    return _saveQuery(_fetchUserQuery(discordID).merge({
      donor: {
        donorAmount: attributes.currently_entitled_amount_cents / 100,
        guilds: [],
        guildRedeems: 0,
        firstDonationDate: attributes.pledge_relationship_start || r.now(),
        declinedSince: null,
        patreonID: user.id
      }
    })).run();
  }
};
