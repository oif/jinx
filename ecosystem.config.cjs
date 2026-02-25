module.exports = {
  apps: [
    {
      name: "jinx",
      script: "./dist/main.js",
      cwd: __dirname,
      node_args: "--env-file=.env --max-old-space-size=4096",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: "3G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
