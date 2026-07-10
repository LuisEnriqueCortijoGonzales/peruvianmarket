// PM2 ecosystem config
// Documentación: https://pm2.keymetrics.io/docs/usage/application-declaration/

const path = require('path');
const deployDir = __dirname;

module.exports = {
  apps: [
    {
      name: 'peruvianmarket',

      // Ejecuta `next start` directamente
      script: path.join(deployDir, 'app', 'node_modules', '.bin', 'next'),
      args: 'start --port 3000',
      cwd: path.join(deployDir, 'app'),

      instances: 1,          // 1 instancia — RPi no tiene suficiente RAM para más
      exec_mode: 'fork',

      autorestart: true,     // Reinicia si el proceso muere
      watch: false,          // No watchear archivos (innecesario en producción)
      // El motor de Pokémon Showdown carga la Pokédex completa en RAM (cientos
      // de MB). Un límite bajo hacía que PM2 reiniciara el proceso a mitad de
      // batalla → las batallas en memoria se perdían (empate automático).
      max_memory_restart: '1500M',

      // Variables de entorno de producción
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        NEXT_TELEMETRY_DISABLED: '1',
      },

      // Log configuration
      out_file: path.join(deployDir, 'logs', 'out.log'),
      error_file: path.join(deployDir, 'logs', 'error.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_size: '10M',
      retain: 7,
    },
  ],
};
