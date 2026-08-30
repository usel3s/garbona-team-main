const { execSync } = require("child_process");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const { Player, QueryType, useQueue } = require("discord-player");
const { DefaultExtractors } = require("@discord-player/extractor");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { ACCENT } = require("./components");

const MUSIC_NODE_OPTIONS = {
  selfDeaf: true,
  disableCompressor: true,
  bufferingTimeout: 30_000,
  volume: 100,
  leaveOnEmpty: true,
  leaveOnEmptyCooldown: 60_000,
  leaveOnEnd: true,
  leaveOnEndCooldown: 2_000,
  pauseOnEmpty: false,
};

let player = null;

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const cmd = process.platform === "win32" ? "where ffmpeg" : "which ffmpeg";
    const found = execSync(cmd, { encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) return found;
  } catch (_) {
    /* optional */
  }
  try {
    return require("ffmpeg-static");
  } catch (_) {
    return null;
  }
}

function resolveVoiceBitrate(channel) {
  const raw = Number(channel?.bitrate);
  if (!Number.isFinite(raw) || raw <= 0) return 96_000;
  return Math.min(raw, 128_000);
}

function getPlayer() {
  return player;
}

async function initMusicPlayer(client) {
  if (player) return player;

  try {
    require("@snazzah/davey");
  } catch (error) {
    logger.error(
      "Discord voice DAVE package missing (@snazzah/davey) — music will not play in voice",
      error.message
    );
    throw error;
  }

  const ffmpegPath = resolveFfmpegPath();
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    logger.info(`Discord music ffmpeg: ${ffmpegPath}`);
  }

  player = new Player(client, {
    skipFFmpeg: false,
    ffmpegPath: ffmpegPath || undefined,
    probeTimeout: 10_000,
  });

  await player.extractors.loadMulti(DefaultExtractors);

  const { YoutubeExtractor } = await import("discord-player-youtube");
  await player.extractors.register(YoutubeExtractor, {
    priority: 10,
    cookie: String(process.env.YOUTUBE_COOKIE || "").trim() || undefined,
    sabrPlaybackOptions: {
      audioQuality: "MEDIUM",
    },
  });

  player.events.on("playerError", async (queue, error, track) => {
    logger.warn("Music track error", error?.message || error);
    const meta = queue.metadata || {};
    const channel = meta.channel;
    const query = meta.lastQuery;
    if (meta.scFallbackTried || !query || /soundcloud\.com|snd\.sc/i.test(query)) {
      if (channel?.isTextBased?.()) {
        channel
          .send({
            embeds: [
              musicEmbed(
                "Не удалось воспроизвести",
                `[${track?.cleanTitle || track?.title || "Трек"}](${track?.url || ""})\n${error?.message || "Ошибка потока"}\n\nПопробуй ссылку SoundCloud или другой трек.`,
                ACCENT.danger
              ),
            ],
          })
          .catch(() => null);
      }
      return;
    }

    queue.metadata = { ...meta, scFallbackTried: true };
    try {
      const fallback = await player.search(query, {
        searchEngine: QueryType.SOUNDCLOUD_SEARCH,
        requestedBy: meta.requestedBy,
      });
      if (fallback.isEmpty()) throw new Error("SoundCloud fallback empty");
      queue.insertTrack(fallback.tracks[0], 0);
      if (queue.node.isPlaying()) {
        queue.node.skip();
      } else {
        await queue.node.play(null);
      }
      if (channel?.isTextBased?.()) {
        channel
          .send({
            embeds: [
              musicEmbed(
                "Fallback SoundCloud",
                `YouTube не отдал поток. Пробую: [${fallback.tracks[0].title}](${fallback.tracks[0].url})`,
                ACCENT.pending
              ),
            ],
          })
          .catch(() => null);
      }
    } catch (fallbackError) {
      logger.warn("Music SoundCloud fallback failed", fallbackError.message);
      if (channel?.isTextBased?.()) {
        channel
          .send({
            embeds: [
              musicEmbed(
                "Не удалось воспроизвести",
                `${error?.message || "Ошибка YouTube"}\nFallback SoundCloud тоже не сработал.`,
                ACCENT.danger
              ),
            ],
          })
          .catch(() => null);
      }
    }
  });

  player.events.on("playerStart", (queue, track) => {
    try {
      queue.node.setBitrate(resolveVoiceBitrate(queue.channel));
    } catch (_) {
      /* optional */
    }

    const channel = queue.metadata?.channel;
    if (!channel?.isTextBased?.()) return;
    channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT.brand)
            .setTitle("Сейчас играет")
            .setDescription(`[${track.cleanTitle || track.title}](${track.url})`)
            .addFields(
              { name: "Автор", value: track.author || "—", inline: true },
              { name: "Длительность", value: track.duration || "—", inline: true },
              { name: "Источник", value: track.source || "—", inline: true }
            )
            .setThumbnail(track.thumbnail || null)
            .setFooter({ text: "Garbona · Музыка" }),
        ],
      })
      .catch(() => null);
  });

  player.events.on("error", (queue, error) => {
    logger.warn("Music queue error", error?.message || error);
  });

  logger.info("Discord music player ready (YouTube MEDIUM + SoundCloud fallback)");
  return player;
}

function detectEngine(query, engine) {
  const q = String(query || "").trim();
  const forced = String(engine || "youtube").toLowerCase();

  if (/music\.yandex\./i.test(q) || /yandex\.(ru|com)\/.*music/i.test(q)) {
    return "yandex_unsupported";
  }
  if (forced === "soundcloud") {
    if (/soundcloud\.com|snd\.sc/i.test(q)) return QueryType.AUTO;
    return QueryType.SOUNDCLOUD_SEARCH;
  }
  if (/soundcloud\.com|snd\.sc/i.test(q)) return QueryType.AUTO;
  if (/youtube\.com|youtu\.be/i.test(q)) return QueryType.AUTO;
  if (forced === "youtube") return QueryType.YOUTUBE_SEARCH;
  if (forced === "auto") return QueryType.YOUTUBE_SEARCH;
  return QueryType.YOUTUBE_SEARCH;
}

function musicEmbed(title, description, color = ACCENT.pending) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Garbona · Музыка" })
    .setTimestamp(new Date());
}

function requireVoice(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) {
    return { ok: false, error: "Зайди в голосовой канал, чтобы управлять музыкой." };
  }
  const me = interaction.guild.members.me;
  if (me?.voice?.channelId && me.voice.channelId !== channel.id) {
    return { ok: false, error: "Бот уже играет в другом голосовом канале." };
  }
  return { ok: true, channel, me };
}

async function destroyGuildMusic(guildId, reason = "Garbona music stop") {
  const queue = useQueue(guildId);
  if (queue) {
    try {
      player.nodes.delete(guildId);
    } catch (error) {
      try {
        queue.delete();
      } catch (_) {
        /* ignore */
      }
      logger.warn("Music queue delete fallback", error?.message || error);
    }
  }

  const guild = player?.client?.guilds?.cache?.get(guildId);
  const me = guild?.members?.me;
  if (me?.voice?.channelId) {
    await me.voice.disconnect(reason).catch((error) => {
      logger.warn("Music voice disconnect failed", error?.message || error);
    });
  }
}

async function resetOrphanMusicVoice(interaction) {
  const me = interaction.guild.members.me;
  if (!me?.voice?.channelId) return;
  if (useQueue(interaction.guildId)) return;
  await me.voice.disconnect("Garbona music reset").catch(() => null);
}

async function handlePlay(interaction) {
  const gate = requireVoice(interaction);
  if (!gate.ok) {
    await interaction.reply({ content: gate.error, ephemeral: true });
    return true;
  }

  const query = interaction.options.getString("query", true);
  const engine = interaction.options.getString("engine") || "youtube";
  const searchEngine = detectEngine(query, engine);

  if (searchEngine === "yandex_unsupported") {
    await interaction.reply({
      content:
        "Яндекс Музыка пока не поддерживается напрямую. Вставь ссылку YouTube / SoundCloud или название трека — найду на YouTube.",
      ephemeral: true,
    });
    return true;
  }

  await interaction.deferReply();
  const started = Date.now();

  try {
    await resetOrphanMusicVoice(interaction);

    const result = await player.play(gate.channel, query, {
      searchEngine,
      nodeOptions: {
        ...MUSIC_NODE_OPTIONS,
        metadata: {
          channel: interaction.channel,
          requestedBy: interaction.user,
          lastQuery: query,
          scFallbackTried: false,
        },
      },
      requestedBy: interaction.user,
    });

    if (result.queue) {
      result.queue.metadata = {
        ...(result.queue.metadata || {}),
        channel: interaction.channel,
        requestedBy: interaction.user,
        lastQuery: query,
        scFallbackTried: false,
      };
    }

    const track = result.track;
    const isPlaylist = Boolean(result.searchResult?.playlist);
    const count = result.searchResult?.tracks?.length || 1;
    const ms = Date.now() - started;

    const embed = musicEmbed(
      isPlaylist ? "Плейлист в очереди" : "Трек добавлен",
      isPlaylist
        ? `**${result.searchResult.playlist.title || "Плейлист"}** · ${count} трек(ов)\nПервый: [${track.cleanTitle || track.title}](${track.url})`
        : `[${track.cleanTitle || track.title}](${track.url})\nИсточник: **${track.source || "auto"}** · ${ms}ms`,
      ACCENT.brand
    ).setThumbnail(track.thumbnail || null);

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.warn("Music play failed", error.message);
    await interaction.editReply({
      embeds: [
        musicEmbed(
          "Не удалось воспроизвести",
          `${error.message || "Неизвестная ошибка"}\n\nПопробуй другую ссылку (YouTube / SoundCloud) или уточни название.`,
          ACCENT.danger
        ),
      ],
    });
  }
  return true;
}

async function handleSkip(interaction) {
  const queue = useQueue(interaction.guildId);
  if (!queue?.isPlaying()) {
    await interaction.reply({ content: "Сейчас ничего не играет.", ephemeral: true });
    return true;
  }
  const current = queue.currentTrack;
  queue.node.skip();
  await interaction.reply({
    embeds: [
      musicEmbed(
        "Пропущено",
        current ? `Пропущен: **${current.cleanTitle || current.title}**` : "Трек пропущен."
      ),
    ],
  });
  return true;
}

async function handleStop(interaction) {
  const queue = useQueue(interaction.guildId);
  const me = interaction.guild.members.me;
  if (!queue && !me?.voice?.channelId) {
    await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
    return true;
  }

  await destroyGuildMusic(interaction.guildId, "Garbona /stop");

  await interaction.reply({
    embeds: [musicEmbed("Остановлено", "Очередь очищена, бот вышел из канала.", ACCENT.danger)],
  });
  return true;
}

async function handlePause(interaction) {
  const queue = useQueue(interaction.guildId);
  if (!queue?.isPlaying()) {
    await interaction.reply({ content: "Сейчас ничего не играет.", ephemeral: true });
    return true;
  }
  queue.node.setPaused(true);
  await interaction.reply({ embeds: [musicEmbed("Пауза", "Воспроизведение на паузе.")] });
  return true;
}

async function handleResume(interaction) {
  const queue = useQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
    return true;
  }
  queue.node.setPaused(false);
  await interaction.reply({
    embeds: [musicEmbed("Продолжение", "Воспроизведение возобновлено.", ACCENT.brand)],
  });
  return true;
}

async function handleQueue(interaction) {
  const queue = useQueue(interaction.guildId);
  if (!queue || (!queue.currentTrack && !queue.tracks.size)) {
    await interaction.reply({ content: "Очередь пуста.", ephemeral: true });
    return true;
  }

  const current = queue.currentTrack;
  const upcoming = queue.tracks.toArray().slice(0, 10);
  const lines = [];
  if (current) {
    lines.push(`**Сейчас:** [${current.cleanTitle || current.title}](${current.url})`);
  }
  if (upcoming.length) {
    lines.push("", "**Далее:**");
    upcoming.forEach((t, i) => {
      lines.push(`\`${i + 1}.\` [${t.cleanTitle || t.title}](${t.url}) · ${t.duration || "?"}`);
    });
  }
  const more = Math.max(0, queue.tracks.size - upcoming.length);
  if (more) lines.push(`\n…и ещё **${more}**`);

  await interaction.reply({
    embeds: [musicEmbed(`Очередь · ${queue.tracks.size + (current ? 1 : 0)}`, lines.join("\n"))],
  });
  return true;
}

async function handleNowPlaying(interaction) {
  const queue = useQueue(interaction.guildId);
  const track = queue?.currentTrack;
  if (!track) {
    await interaction.reply({ content: "Сейчас ничего не играет.", ephemeral: true });
    return true;
  }
  const progress = queue.node.createProgressBar?.() || track.duration || "";
  await interaction.reply({
    embeds: [
      musicEmbed(
        "Сейчас играет",
        `[${track.cleanTitle || track.title}](${track.url})\n${progress}`
      ).setThumbnail(track.thumbnail || null),
    ],
  });
  return true;
}

const MUSIC_COMMANDS = new Set([
  "play",
  "skip",
  "stop",
  "pause",
  "resume",
  "queue",
  "np",
]);

async function handleMusicCommand(interaction) {
  if (!MUSIC_COMMANDS.has(interaction.commandName)) return false;
  if (!player) {
    await interaction.reply({
      content: "Музыкальный модуль ещё не готов. Попробуй через минуту.",
      ephemeral: true,
    });
    return true;
  }

  return player.context.provide({ guild: interaction.guild }, async () => {
    switch (interaction.commandName) {
      case "play":
        return handlePlay(interaction);
      case "skip":
        return handleSkip(interaction);
      case "stop":
        return handleStop(interaction);
      case "pause":
        return handlePause(interaction);
      case "resume":
        return handleResume(interaction);
      case "queue":
        return handleQueue(interaction);
      case "np":
        return handleNowPlaying(interaction);
      default:
        return false;
    }
  });
}

module.exports = {
  initMusicPlayer,
  getPlayer,
  handleMusicCommand,
  MUSIC_COMMANDS,
};
