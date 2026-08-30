/**
 * PM2: pm2 start ecosystem.config.cjs
 * Переменные окружения подхватываются из .env (dotenv в приложении) или задайте env в блоке ниже.
 */
module.exports = {
  apps: [
    {
      name: "garbona-bot",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "750M",
      min_uptime: "30s",
      max_restarts: 10,
      restart_delay: 15000,
      exp_backoff_restart_delay: 5000,
      merge_logs: true,
      time: true,
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      // Раскомментируйте для ежедневного мягкого перезапуска в 04:00 (серверное время)
      // cron_restart: "0 4 * * *",
    },
  ],
};
