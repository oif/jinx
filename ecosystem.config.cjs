module.exports = {
  apps: [
    {
      name: "jinx",
      script: "./dist/main.js",
      cwd: __dirname,
      node_args: "--env-file=.env --max-old-space-size=8192",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: "12G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "jinx-dashboard",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: __dirname + "/site",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
