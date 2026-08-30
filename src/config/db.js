const mongoose = require("mongoose");
const { env } = require("./env");
const { logger } = require("../utils/logger");

async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri, {
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
  });
  logger.info("MongoDB connected");
}

module.exports = { connectDatabase };
