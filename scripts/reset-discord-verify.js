#!/usr/bin/env node
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const DiscordVerifySession = require("../src/models/DiscordVerifySession");

const DISCORD_ID = process.argv[2] || "990068609441234955";

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const user = await User.findOne({ discordId: DISCORD_ID });
  if (user) {
    console.log("Found user:", user.telegramId, user.username);
    user.discordId = "";
    user.discordUsername = "";
    user.discordVerifiedAt = null;
    await user.save();
    console.log("Cleared discord fields for user", user.telegramId);
  } else {
    console.log("No user linked to discordId", DISCORD_ID);
  }

  const sessions = await DiscordVerifySession.updateMany(
    { discordId: DISCORD_ID, consumedAt: null },
    { $set: { consumedAt: new Date(), method: "" } }
  );
  console.log("Closed open sessions:", sessions.modifiedCount);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
