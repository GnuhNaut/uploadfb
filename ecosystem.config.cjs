module.exports = {
  apps: [{
    name: "uploadfb",
    script: "./src/index.js",
    watch: false,
    env: {
      NODE_ENV: "development",
    },
    env_production: {
      NODE_ENV: "production",
    }
  }]
}
