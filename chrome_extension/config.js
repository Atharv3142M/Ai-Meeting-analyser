// API Configuration for POAi Python Backend
const API_CONFIG = {
  BASE_URL: 'http://127.0.0.1:5000',
  ENDPOINTS: {
    UPLOAD: '/upload',
    RECORDINGS: '/recordings',
    HEALTH: '/health'
  }
};

// Helper to keep console logs clean
console.log("POAi Config Loaded: Backend at " + API_CONFIG.BASE_URL);