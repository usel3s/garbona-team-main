#!/usr/bin/env node
/**
 * Configure Discord channel topics + create admin logging category.
 * Usage: node scripts/setup-discord-channel-topics.js [--apply]
 */
require("dotenv").config();
const {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");
const { env } = require("../src/config/env");

const APPLY = process.argv.includes("--apply");

const TOPICS = {
  "🔗・верификация": "Пройди верификацию Garbona, чтобы открыть сервер. Нажми кнопку и подтверди аккаунт.",
  "📖・памятка": "Краткая памятка по серверу: роли, каналы, уведомления и полезные разделы.",
  "📘・правила": "Правила сервера Garbona. Прочитай перед общением и работой в команде.",
  "🤖・статус": "Живой статус сервисов: панель, API, Discord и Telegram боты, задержки.",
  "📢・новости": "Официальные новости и объявления команды Garbona.",
  "🔧・профит": "Карточки новых логов и MaFile. Только для чтения — обсуждение в других каналах.",
  "✨・предложения":
    "Идеи по лендам, панели, Steam/логам, MaFile, боту, автопродаже, кошельку и Discord. Одна тема — одна идея, с тегом направления.",
  "🐞・поддержка": "Вопросы по работе, баги и помощь. Опиши проблему коротко и по делу.",
  "💭・общение": "Свободное общение участников команды. Без спама и оффтопа вне контекста.",
  "🗑️・корзина": "Канал для флуда и временных сообщений. Важное сюда не пиши.",
  "🛠️・управление": "Панель управления приватными голосовыми комнатами. Кнопки работают только владельцу комнаты.",
  "➕・Создать комнату": "Зайди в этот канал, чтобы создать свою приватную голосовую комнату.",
  "🔗・discord.gg/garbona": "Публичный инвайт сервера: https://discord.gg/VNQfrk5Wn5",
  "переговоры о важном": "Голосовой канал для рабочих созвонов и важных обсуждений.",
  "developer-test": "Тестовый канал разработки. Не для обычного общения.",
  "log-verif": "Устаревший канал логов верификации. Актуальные логи — в категории Админ.",
};

const ADMIN_CATEGORY = "🔒・админ";
const ADMIN_CHANNELS = [
  {
    name: "🪪・верификация",
    topic: "Логи успешной и неуспешной верификации Discord ↔ Garbona.",
    key: "verify",
  },
  {
    name: "🛡️・модерация",
    topic: "Логи банов, киков, мутов и других действий модерации.",
    key: "mod",
  },
  {
    name: "📥・система",
    topic: "Системные события бота: ошибки, важные уведомления, служебные логи.",
    key: "system",
  },
];

function topicFor(channel) {
  if (TOPICS[channel.name]) return TOPICS[channel.name];
  if (channel.type === ChannelType.GuildVoice) {
    return `Голосовой канал «${channel.name}». Соблюдай правила сервера.`;
  }
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    return `Канал «${channel.name}». Используй по назначению и соблюдай правила.`;
  }
  if (channel.type === ChannelType.GuildForum) {
    return `Форум «${channel.name}». Создавай отдельные темы под предложения.`;
  }
  return "";
}

async function main() {
  if (!env.discordBotToken || !env.discordGuildId) {
    throw new Error("DISCORD_BOT_TOKEN / DISCORD_GUILD_ID required");
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));

  const guild = await client.guilds.fetch(env.discordGuildId);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const staffRoleId =
    String(env.discordEmbedRoleId || "").trim() ||
    [...guild.roles.cache.values()].find((r) => /admin|staff|модер|куратор/i.test(r.name))?.id ||
    "";
  const verifiedRoleId = String(env.discordVerifiedRoleId || "").trim();

  console.log(`mode=${APPLY ? "APPLY" : "DRY"} guild=${guild.name}`);
  console.log(`staffRole=${staffRoleId || "—"} verified=${verifiedRoleId || "—"}`);

  // Topics for existing text/voice/forum/news
  for (const channel of guild.channels.cache.values()) {
    if (
      ![
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
      ].includes(channel.type)
    ) {
      continue;
    }
    const topic = topicFor(channel).slice(0, 1024);
    if (!topic) continue;
    if (String(channel.topic || "") === topic) {
      console.log(`topic ok  #${channel.name}`);
      continue;
    }
    console.log(`topic set #${channel.name} → ${topic.slice(0, 72)}…`);
    if (APPLY) {
      try {
        await channel.setTopic(topic, "Garbona channel topic setup");
      } catch (error) {
        console.warn(`topic fail #${channel.name}: ${error.message}`);
      }
    }
  }

  // Admin category + channels
  let adminCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === ADMIN_CATEGORY
  );
  if (!adminCategory) {
    console.log(`create category ${ADMIN_CATEGORY}`);
    if (APPLY) {
      adminCategory = await guild.channels.create({
        name: ADMIN_CATEGORY,
        type: ChannelType.GuildCategory,
        reason: "Garbona admin logs",
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          ...(staffRoleId
            ? [
                {
                  id: staffRoleId,
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages,
                  ],
                },
              ]
            : []),
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ],
      });
    }
  } else {
    console.log(`category exists ${ADMIN_CATEGORY}`);
  }

  const createdIds = {};
  for (const spec of ADMIN_CHANNELS) {
    let ch = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === spec.name
    );
    if (!ch && adminCategory) {
      console.log(`create #${spec.name}`);
      if (APPLY) {
        ch = await guild.channels.create({
          name: spec.name,
          type: ChannelType.GuildText,
          parent: adminCategory.id,
          topic: spec.topic,
          reason: "Garbona admin logs",
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            ...(staffRoleId
              ? [
                  {
                    id: staffRoleId,
                    allow: [
                      PermissionFlagsBits.ViewChannel,
                      PermissionFlagsBits.ReadMessageHistory,
                      PermissionFlagsBits.SendMessages,
                    ],
                  },
                ]
              : []),
            {
              id: client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ManageMessages,
              ],
            },
          ],
        });
      }
    } else if (ch) {
      console.log(`exists #${spec.name} ${ch.id}`);
      if (APPLY && String(ch.topic || "") !== spec.topic) {
        await ch.setTopic(spec.topic, "Garbona admin topic").catch(() => null);
      }
      if (APPLY && adminCategory && ch.parentId !== adminCategory.id) {
        await ch.setParent(adminCategory.id, { lockPermissions: false }).catch(() => null);
      }
    }
    if (ch) createdIds[spec.key] = ch.id;
  }

  // Soft defaults on public info channels
  if (APPLY) {
    for (const name of ["📢・новости", "🤖・статус", "🔧・профит", "📘・правила", "📖・памятка"]) {
      const ch = guild.channels.cache.find((c) => c.name === name);
      if (!ch || ch.type !== ChannelType.GuildText) continue;
      try {
        await ch.permissionOverwrites.edit(guild.roles.everyone, {
          SendMessages: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
        });
        if (verifiedRoleId) {
          await ch.permissionOverwrites.edit(verifiedRoleId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false,
          });
        }
        console.log(`lock send #${name}`);
      } catch (error) {
        console.warn(`perms #${name}: ${error.message}`);
      }
    }

    const chat = guild.channels.cache.find((c) => c.name === "💭・общение");
    if (chat?.type === ChannelType.GuildText) {
      try {
        await chat.setRateLimitPerUser(3, "Anti-spam slowmode");
        console.log("slowmode #💭・общение = 3s");
      } catch (error) {
        console.warn("slowmode fail", error.message);
      }
    }
  }

  console.log("\nAdmin channel ids:");
  console.log(JSON.stringify(createdIds, null, 2));
  if (createdIds.verify) {
    console.log(`\nSet DISCORD_LOG_CHANNEL_ID=${createdIds.verify}`);
  }
  if (createdIds.mod) {
    console.log(`Set DISCORD_MOD_LOG_CHANNEL_ID=${createdIds.mod}`);
  }
  if (createdIds.system) {
    console.log(`Set DISCORD_SYSTEM_LOG_CHANNEL_ID=${createdIds.system}`);
  }

  await client.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
