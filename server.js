const cluster = require('cluster')
const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const r = require('rethinkdbdash')()
const config = require('./config.json')
const crypto = require('crypto')
const fs = require('fs')

app.use(bodyParser.text({type: '*/*'}))

// discordbots.org webhooks
app.post('/dblwebhook', async (req, res) => {
  req.body = JSON.parse(req.body)
  if (req.headers.authorization) {
    if ((req.headers.authorization === config.dblorg_webhook_secret) && (req.body.type === 'upvote')) {
      await addPocket(req.body.user, 250) 
      res.send({status: 200})
    } else {
      res.send({status: 401})
    }
  } else {
    res.send({status: 403})
  }
})

// Patreon webhooks
app.post('/patreonwebhook', async (req, res) => {
    if (req.headers['x-patreon-signature']) {
      if (validatePatreonIdentity(req)) {
        req.body = JSON.parse(req.body)
        if (req.headers['x-patreon-event'] === "members:pledge:create") {
          await addDonor(req.body)
        } else if (req.headers['x-patreon-event'] === "members:pledge:delete") {
          await removeDonor(req.body)
        } else if (req.headers['x-patreon-event'] === "members:pledge:update") {
          await updateDonor(req.body)
        }
        res.send({status: 200})
      } else {
        res.send({status: 401})
      }
    } else {
      res.send({status: 403})
    }
})

app.use(function (req, res, next) {
  res.status(404).send({error: "404: You in the wrong part of town, boi."});
});

async function addDonor(body) {
  const user = body.included.find(inc => inc.type === 'user');
    if (!user.attributes.social_connections || !user.attributes.social_connections.discord || !user.attributes.social_connections.discord.user_id) {
      return
    }
    return r.table('donors')
    .insert({
      id: user.attributes.social_connections.discord.user_id,
      donorAmount: body.data.attributes.currently_entitled_amount_cents / 100,
      guilds: [],
      guildRedeems: 0,
      firstDonationDate: body.data.attributes.pledge_relationship_start || r.now(),
      declinedSince: null,
      patreonID: user.id,
    }, { conflict: 'update' })
    .run()
}

function removeDonor(body) {
    const user = body.included.find(inc => inc.type === 'user');
    return r.table('donors')
      .getAll(user.id, {index: 'patreonID'})
      .delete()
      .run()
}

async function updateDonor(body) {
  const user = body.included.find(inc => inc.type === 'user');
  let donor;
  if (user.attributes.social_connections && user.attributes.social_connections.discord && user.attributes.social_connections.discord.user_id) {
    donor = await r.table('donors').get(user.attributes.social_connections.discord.user_id).run()
    //Add patreon id to old objects 
    if (!donor.patreonID) {
      donor.patreonID = user.id
    }
  } else {
    donor = await r.table('donors').getAll(user.id, {index: 'patreonID'}).run().then(users => users[0])
  }
  if (!donor) {
    return //Exploit to look at, if a old patron unlinked their discord account and decreased their pledge, they will be able to bypass this
  }
  //Reset redeemed guilds if the patron decreased the amount they pledge and they don't meet the requirements anymore
  if ((donor.guilds.length > 3 && body.data.attributes.currently_entitled_amount_cents < 2000) 
  || (donor.guilds.length > 0 && body.data.attributes.currently_entitled_amount_cents < 300)) {
    donor.guilds = [],
    donor.guildRedeems = 0
  }
  return r.table('donors')
    .update({...donor, donorAmount: body.data.attributes.currently_entitled_amount_cents / 100})
    .run()
}

function launchServer () {
  const http = require('http')
  http.createServer(app).listen(8585)
  console.log(`Server started on port 8585 pid: ${process.pid}`)
};

launchServer();

function validatePatreonIdentity(req) {
  let hash = req.headers['x-patreon-signature'],
      hmac = crypto.createHmac("md5", config.patreon_webhook_secret); 
  hmac.update(req.body);
  let crypted = hmac.digest("hex");
  return crypted === hash;
}

function formatTime (time) {
  let days = Math.floor(time % 31536000 / 86400)
  let hours = Math.floor(time % 31536000 % 86400 / 3600)
  let minutes = Math.floor(time % 31536000 % 86400 % 3600 / 60)
  let seconds = Math.round(time % 31536000 % 86400 % 3600 % 60)
  days = days > 9 ? days : '0' + days
  hours = hours > 9 ? hours : '0' + hours
  minutes = minutes > 9 ? minutes : '0' + minutes
  seconds = seconds > 9 ? seconds : '0' + seconds
  return `${days > 0 ? `${days}:` : ``}${(hours || days) > 0 ? `${hours}:` : ``}${minutes}:${seconds}`
}

async function getUser (userID) {
  let user = await r.table('users').get(userID)

  if (!user) {
    user = (await r.table('users').insert({
      id: userID, // User id/rethink id
      pls: 1, // Total commands ran
      lastCmd: Date.now(), // Last command time
      lastRan: 'nothing', // Last command ran
      spam: 0, // Spam means 2 commands in less than 1s
      pocket: 0, // Coins not in bank account
      bank: 0, // Coins in bank account
      lost: 0, // Total coins lost
      won: 0, // Total coins won
      shared: 0, // Transferred to other players
      streak: {
        time: 0, // Time since last daily command
        streak: 0 // Total current streak
      },
      donor: false, // Donor status, false or $amount
      godMode: false, // No cooldowns, only for select few
      vip: false, // Same cooldowns as donors without paying
      upvoted: false // DBL voter status
    }, {
      returnChanges: true
    }).run()).changes[0].new_val
  }

  return user
}

async function addPocket (id, amount) {
  let res = await getUser(id)
  res.pocket += amount
  res.upvoted = true

  return r.table('users')
    .insert(res, { conflict: 'update' })
}
