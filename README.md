# octopus-web-app


## Octopus AI V4 — Puter integration

This frontend uses Puter.js directly for the AI model, so AI usage is charged to the signed-in user's Puter account under Puter's User-Pays Model. The frontend does not contain an OpenAI API key, Groq key, Firebase service account, or Tavily key.

### Configuration

Edit `v4-config.js` only if your backend URL changes:

```js
window.OCTOPUS_CONFIG = {
  V4_BACKEND_URL: "https://octopus-ai-v4-1.onrender.com",
  PUTER_MODEL: "gpt-5.6-luna",
  MAX_TOOL_ROUNDS: 5,
  REQUEST_TIMEOUT_MS: 45000,
  ENABLE_PUTER_WEB_SEARCH: true
};
```

### What was fixed

- Puter.js is loaded before the application on both `index.html` and `chat.html`.
- Chat is gated behind Puter sign-in.
- Header auth state changes between `Sign in` and green `Connected`.
- AI generation now runs through `puter.ai.chat()` instead of the old direct backend AI call.
- GPT-5.6 Luna is selected through Puter.
- Puter function calling can use the V4 backend's `/api/agent/context`, `/api/agent/tools`, and `/api/agent/tool` endpoints.
- Built-in Puter web search is enabled as a fallback/current-information tool.
- No developer AI API key is shipped to the browser.
- Removed the fake Kochi fallback when browser geolocation fails.
- Added Kerala coordinate validation to prevent obvious Africa/Atlantic map markers.
- Fixed duplicate Leaflet loading and stale localhost backend text.
- Added the map panel to the landing-page embedded chat.
- Added cache-busting for the new V4 files.
- Preserved the existing Octopus AI UI and renderer.

### Deployment

Upload the folder to Firebase Hosting or another static host. The V4 backend must expose the agent endpoints used above and allow CORS from the frontend domain.

If the backend URL changes, update `v4-config.js`; do not put any backend secrets in that file.
