window.OCTOPUS_CONFIG = Object.assign({
  V4_BACKEND_URL: "https://octopus-ai-v4-1.onrender.com",
  PUTER_MODEL: "gpt-5.6-luna",
  MAX_TOOL_ROUNDS: 5,
  REQUEST_TIMEOUT_MS: 45000,
  ENABLE_PUTER_WEB_SEARCH: true
}, window.OCTOPUS_CONFIG || {});
