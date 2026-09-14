// V4 Puter configuration is loaded from v4-config.js.
const AI_BACKEND_URL = ((window.OCTOPUS_CONFIG && window.OCTOPUS_CONFIG.V4_BACKEND_URL) || "").replace(/\/$/, "") + "/api/chat";

// DOM
const octopusInput = document.getElementById("octopusInput");
const answerCanvas = document.getElementById("answerCanvas");
const emptyStatePanel = document.getElementById("emptyStatePanel");
const canvasArea = document.getElementById("canvasArea");
const sendBtn = document.getElementById("sendBtn");

// Chat state
let conversationHistory = [];
let currentPlaceId = null;
let lastMatchedPlaceIds = [];

// Location state
let userLat = null;
let userLng = null;
let userLocationText = "";
let userLocation = null;
let locationState = "LOCATION_UNKNOWN";
let locationPermissionState = "unknown";
let locationRequestPromise = null;
let liveLocationWatcher = null;
let activeRequestController = null;

const LOCATION_CACHE_KEY = "octopus_location_cache_v1";
const LOCATION_DENIAL_NOTICE_KEY = "octopus_location_denial_noticed_v1";
const LOCATION_CACHE_MS = 10 * 60 * 1000;
const OCTOPUS_DEBUG = Boolean(window.OCTOPUS_CONFIG && window.OCTOPUS_CONFIG.DEBUG);

function debugEvent(event, detail = {}) {
    if (OCTOPUS_DEBUG) console.debug("[Octopus]", event, detail);
}


// Map state
let octopusMap = null;
let mapMarkers = [];

// Multi chat state
let chatSessions = [];
let activeChatId = null;

const CHAT_STORAGE_KEY = "octopus_chat_sessions_v1";


// =====================================================
// CHAT SESSIONS
// =====================================================

function initChatSessions() {
    const saved = localStorage.getItem(CHAT_STORAGE_KEY);

    if (saved) {
        try {
            chatSessions = JSON.parse(saved);
        } catch (e) {
            chatSessions = [];
        }
    }

    if (!Array.isArray(chatSessions) || chatSessions.length === 0) {
        const firstChat = createEmptyChat("New chat");
        chatSessions = [firstChat];
        activeChatId = firstChat.id;
    } else {
        activeChatId = chatSessions[0].id;
    }

    renderChatTabs();
    loadActiveChatSession();
}

function createEmptyChat(title = "New chat") {
    return {
        id: Date.now().toString() + Math.random().toString(16).slice(2),
        title,
        messagesHtml: "",
        history: [],
        currentPlaceId: null,
        lastMatchedPlaceIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

function saveChatSessions() {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatSessions));
}

function getActiveChatSession() {
    return chatSessions.find(chat => chat.id === activeChatId);
}

function saveCurrentChatSession() {
    const active = getActiveChatSession();
    if (!active) return;

    active.messagesHtml = answerCanvas ? answerCanvas.innerHTML : "";
    active.history = conversationHistory || [];
    active.currentPlaceId = currentPlaceId || null;
    active.lastMatchedPlaceIds = lastMatchedPlaceIds || [];
    active.updatedAt = Date.now();

    saveChatSessions();
}

function loadActiveChatSession() {
    const active = getActiveChatSession();
    if (!active) return;

    if (answerCanvas) {
        answerCanvas.innerHTML = active.messagesHtml || "";
    }

    conversationHistory = active.history || [];
    currentPlaceId = active.currentPlaceId || null;
    lastMatchedPlaceIds = active.lastMatchedPlaceIds || [];

    if (emptyStatePanel) {
        emptyStatePanel.style.display = active.messagesHtml ? "none" : "grid";
    }

    if (answerCanvas) {
        if (active.messagesHtml) {
            answerCanvas.classList.add("active");
        } else {
            answerCanvas.classList.remove("active");
        }
    }

    autoGrowInput();
    scrollCanvasBottom();
}

function createNewChatSession() {
    saveCurrentChatSession();

    const newChat = createEmptyChat("New chat");

    chatSessions.unshift(newChat);
    activeChatId = newChat.id;

    conversationHistory = [];
    currentPlaceId = null;
    lastMatchedPlaceIds = [];

    saveChatSessions();
    renderChatTabs();
    loadActiveChatSession();

    octopusInput.value = "";
    autoGrowInput();
    octopusInput.focus();
}

function switchChatSession(chatId) {
    if (chatId === activeChatId) return;

    saveCurrentChatSession();
    activeChatId = chatId;

    saveChatSessions();
    renderChatTabs();
    loadActiveChatSession();

    octopusInput.focus();
}

function closeChatSession(event, chatId) {
    event.stopPropagation();

    if (chatSessions.length === 1) {
        const newChat = createEmptyChat("New chat");
        chatSessions = [newChat];
        activeChatId = newChat.id;
    } else {
        const closingIndex = chatSessions.findIndex(chat => chat.id === chatId);

        chatSessions = chatSessions.filter(chat => chat.id !== chatId);

        if (activeChatId === chatId) {
            const nextChat = chatSessions[Math.max(0, closingIndex - 1)] || chatSessions[0];
            activeChatId = nextChat.id;
        }
    }

    saveChatSessions();
    renderChatTabs();
    loadActiveChatSession();
}

function renderChatTabs() {
    const tabs = document.getElementById("chatTabs");
    if (!tabs) return;

    tabs.innerHTML = chatSessions.map(chat => {
        const title = escapeHtml(chat.title || "New chat");

        return `
            <button class="chat-tab ${chat.id === activeChatId ? "active" : ""}" onclick="switchChatSession('${chat.id}')">
                <span class="chat-tab-title">${title}</span>
                <span class="chat-tab-close" onclick="closeChatSession(event, '${chat.id}')">×</span>
            </button>
        `;
    }).join("");
}

function updateActiveChatTitleFromFirstMessage() {
    const active = getActiveChatSession();
    if (!active) return;

    if (active.title && active.title !== "New chat") return;

    const firstUserMessage = conversationHistory.find(m => m.role === "user")?.content;

    if (!firstUserMessage) return;

    active.title = firstUserMessage.length > 22
        ? firstUserMessage.slice(0, 22) + "..."
        : firstUserMessage;

    saveChatSessions();
    renderChatTabs();
}


// =====================================================
// UI EFFECTS
// =====================================================

function setPointerPosition(x, y) {
    document.documentElement.style.setProperty("--mx", `${x}px`);
    document.documentElement.style.setProperty("--my", `${y}px`);
}

function createRipple(x, y) {
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    document.body.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
}

window.addEventListener("pointermove", (e) => {
    setPointerPosition(e.clientX, e.clientY);
}, { passive: true });

window.addEventListener("pointerdown", (e) => {
    setPointerPosition(e.clientX, e.clientY);
    createRipple(e.clientX, e.clientY);
}, { passive: true });

function startAutoRipples() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setInterval(() => {
        createRipple(
            Math.random() * window.innerWidth,
            Math.random() * window.innerHeight
        );
    }, 4200);
}


// =====================================================
// INPUT
// =====================================================

function autoGrowInput() {
    if (!octopusInput) return;

    octopusInput.style.height = "auto";
    octopusInput.style.height = Math.min(octopusInput.scrollHeight, 180) + "px";
}

function usePrompt(text) {
    octopusInput.value = text;
    autoGrowInput();
    octopusInput.focus();
}

function resetChatCanvas() {
    answerCanvas.innerHTML = "";
    answerCanvas.classList.remove("active");
    emptyStatePanel.style.display = "grid";

    octopusInput.value = "";
    conversationHistory = [];
    currentPlaceId = null;
    lastMatchedPlaceIds = [];

    saveCurrentChatSession();

    autoGrowInput();
    octopusInput.focus();
}

if (octopusInput) {
    octopusInput.addEventListener("input", autoGrowInput);

    octopusInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendOctopusMessage();
        }
    });
}


// =====================================================
// SEND MESSAGE
// =====================================================

async function sendOctopusMessage() {
    const text = octopusInput.value.trim();
    if (!text || sendBtn.disabled) return;

    try {
        if (typeof puter === "undefined" || !puter.auth || !puter.ai) {
            showPuterLoginPopup(text);
            return;
        }

        const signedIn = await puter.auth.isSignedIn();
        if (!signedIn) {
            showPuterLoginPopup(text);
            return;
        }
    } catch (authError) {
        console.error("Puter authentication check failed:", authError);
        showPuterLoginPopup(text);
        return;
    }

    // Location is requested only after an intentional, location-aware question.
    // A declined request still proceeds with manual/no-location context.
    const webIntent = classifyWebIntent(text);
    if (webIntent.needsLocation) {
        await ensureLocationForQuery(text, webIntent);
    }

    emptyStatePanel.style.display = "none";
    answerCanvas.classList.add("active");
    appendUserCard(text);
    conversationHistory.push({ role: "user", content: text });
    updateActiveChatTitleFromFirstMessage();

    const loadingId = appendLoadingCard();
    octopusInput.value = "";
    autoGrowInput();
    sendBtn.disabled = true;

    try {
        if (!window.OctopusPuterAgent) {
            throw new Error("Octopus Puter agent did not load.");
        }

        if (activeRequestController) activeRequestController.abort();
        activeRequestController = new AbortController();
        const data = await window.OctopusPuterAgent.ask({
            message: text,
            history: conversationHistory.slice(-11, -1),
            currentPlaceId,
            lastMatchedPlaceIds,
            userLat,
            userLng,
            userLocationText,
            location: buildLocationContext(),
            currentTime: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            capabilities: { webSearch: true, maps: !!window.L, nearbySearch: true, weather: true },
            intent: webIntent.type,
            signal: activeRequestController.signal
        });
        if (webIntent.type === "LOCATION_SELF" && userLocation && userLocation.source === "browser_gps") data.locationInfo = userLocation;

        currentPlaceId = data.currentPlaceId || currentPlaceId;
        lastMatchedPlaceIds = Array.isArray(data.lastMatchedPlaceIds)
            ? data.lastMatchedPlaceIds
            : lastMatchedPlaceIds;

        conversationHistory.push({
            role: "assistant",
            content: data.reply || ""
        });

        replaceLoadingCard(loadingId, data);
    } catch (error) {
        console.error("Octopus AI request failed:", error);
        replaceLoadingCard(loadingId, {
            reply: error && error.message === "Puter sign-in is required."
                ? "Please sign in with Puter to continue."
                : `I couldn't reach Octopus AI right now.\n\nPlease try again in a moment.`,
            ui: { showCards: false, showBigImage: false },
            matchedPlaces: []
        });
    } finally {
        activeRequestController = null;
        saveCurrentChatSession();
        sendBtn.disabled = false;
        octopusInput.focus();
    }
}


// =====================================================
// MESSAGE CARDS
// =====================================================

function appendUserCard(text) {
    const card = document.createElement("div");
    card.className = "answer-card user-card";

    card.innerHTML = `
        <div class="answer-label">You</div>
        <div class="answer-text">${escapeHtml(text)}</div>
    `;

    answerCanvas.appendChild(card);
    scrollCanvasBottom();
}

function appendLoadingCard() {
    const id = "loading-" + Date.now();

    const card = document.createElement("div");
    card.className = "answer-card ai-card loading-card";
    card.id = id;

    card.innerHTML = `
        <div class="answer-label">Octopus AI</div>

        <div class="octopus-thinking">
            <div class="octo-runner">
                <div class="octo-body">🐙</div>
                <div class="bubble b1"></div>
                <div class="bubble b2"></div>
                <div class="bubble b3"></div>
            </div>

            <div class="thinking-copy">
                <div class="thinking-title">Octopus is exploring Kerala...</div>
                <div class="thinking-sub">
                    Searching destinations, routes, images and nearby services
                </div>

                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        </div>
    `;

    answerCanvas.appendChild(card);
    scrollCanvasBottom();

    return id;
}
function getDomainFromUrl(url) {
    try {
        return new URL(url).hostname.replace("www.", "");
    } catch (e) {
        return "source";
    }
}

function getFaviconUrl(url) {
    try {
        const domain = new URL(url).origin;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch (e) {
        return "";
    }
}

function renderLiveSources(results) {
    if (!results || !Array.isArray(results) || results.length === 0) return "";

    return `
        <div class="live-source-section">
            <div class="live-source-head">
                <span class="live-dot"></span>
                <span>Live sources</span>
            </div>

            <div class="live-source-grid">
                ${results.slice(0, 3).map((item) => {
        const url = item.url || item.link || "#";
        const domain = getDomainFromUrl(url);
        const favicon = getFaviconUrl(url);
        const title = item.title || "Source";
        const content = item.content || item.snippet || "";

        return `
                        <a class="live-source-card" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
                            <div class="source-logo-wrap">
                                ${favicon
                ? `<img src="${escapeAttr(favicon)}" class="source-logo" alt="${escapeAttr(domain)} logo">`
                : `<span class="source-logo-fallback">${escapeHtml(domain.charAt(0).toUpperCase())}</span>`
            }
                            </div>

                            <div class="source-content">
                                <div class="source-domain">${escapeHtml(domain)}</div>
                                <div class="source-title">${escapeHtml(title)}</div>
                                <p class="source-snippet">${escapeHtml(content)}</p>
                            </div>

                            <div class="source-open">↗</div>
                        </a>
                    `;
    }).join("")}
            </div>
        </div>
    `;
}

function replaceLoadingCard(id, data) {
    const card = document.getElementById(id);
    if (!card) return;

    try {
        const reply = data.reply || data.answer || "Sorry, I could not answer that now.";

        const ui = data.ui || {};
        const media = data.media || null;

        const responseType = data.responseType || ui.cardMode || "text";

        const placeCards = Array.isArray(data.matchedPlaces)
            ? data.matchedPlaces
            : [];

        const knowledgeResults = Array.isArray(data.results)
            ? data.results
            : [];

        const primaryResult = data.primaryResult || null;

        const liveSources = Array.isArray(data.liveResults)
            ? data.liveResults
            : [];

        const suggestedQuestions = Array.isArray(data.suggestedQuestions)
            ? data.suggestedQuestions
            : [];

        const lastUserMessage =
            conversationHistory
                .filter(m => m.role === "user")
                .slice(-1)[0]?.content || "";

        const mapRoutePoints =
            data.mapRoute && Array.isArray(data.mapRoute.points)
                ? data.mapRoute.points
                : [];

        const mapPlaces = [
            ...placeCards.filter(hasLatLng),
            ...mapRoutePoints.filter(hasLatLng)
        ];

        const shouldShowMap =
            (data.mapRoute?.enabled && mapPlaces.length > 0) ||
            (isMapQuestion(lastUserMessage) && mapPlaces.length > 0);

        let showCards = false;

        if (
            responseType === "knowledge_card" ||
            responseType === "service_guide" ||
            responseType === "emergency_card" ||
            responseType === "education_guide"
        ) {
            showCards = knowledgeResults.length > 0 || !!primaryResult;
        } else if (ui.cardMode === "osm_service_cards" || responseType === "service_cards") {
            showCards = placeCards.length > 0;
        } else {
            showCards = shouldShowImageCards(lastUserMessage, data);
        }

        const safeUi = {
            ...ui,
            showCards,
            showBigImage: shouldShowBigImage(lastUserMessage, media, ui)
        };

        card.classList.add("is-resolving");

        setTimeout(() => {
            try {
                card.className = "answer-card ai-card answer-reveal";

                let resultHtml = "";

                if (
                    responseType === "knowledge_card" ||
                    responseType === "service_guide" ||
                    responseType === "emergency_card" ||
                    responseType === "education_guide"
                ) {
                    resultHtml = renderKnowledgeCardsSafe(
                        knowledgeResults,
                        primaryResult,
                        responseType
                    );
                } else {
                    resultHtml = renderSmartCards(placeCards, safeUi);
                }

                card.innerHTML = `
                    <div class="answer-label">
                        Octopus AI
                        ${renderResponseBadgeSafe(responseType)}
                    </div>

                    <div class="answer-text type-reveal">${formatReply(reply)}</div>

                    ${renderAnswerQualitySafe(data.answerQuality)}
                    ${renderLocationInfo(data.locationInfo)}
                    ${renderTripMetaSafe(data)}
                    ${renderLiveSources(liveSources)}
                    ${renderBigImage(media, safeUi)}
                    ${resultHtml}
                    ${renderSuggestedQuestionsSafe(suggestedQuestions)}
                    ${renderMapActionButton(mapPlaces, shouldShowMap)}
                `;

                if (shouldShowMap) {
                    showPlacesOnMap(mapPlaces, "Places from Octopus AI");
                }
                if (data.locationInfo) showPlacesOnMap([], "Your location");

                saveCurrentChatSession();
                scrollCanvasBottom();

            } catch (renderError) {
                console.error("Render error:", renderError);

                card.className = "answer-card ai-card answer-reveal";
                card.innerHTML = `
                    <div class="answer-label">Octopus AI</div>
                    <div class="answer-text type-reveal">
                        ${formatReply(reply)}
                        <br><br>
                        <strong>Frontend render error:</strong> ${escapeHtml(renderError.message)}
                    </div>
                `;
            }
        }, 420);

    } catch (error) {
        console.error("replaceLoadingCard error:", error);

        card.className = "answer-card ai-card answer-reveal";
        card.innerHTML = `
            <div class="answer-label">Octopus AI</div>
            <div class="answer-text type-reveal">
                Frontend error: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderResponseBadgeSafe(responseType) {
    if (!responseType || responseType === "text") return "";

    return `
        <span class="response-badge">
            ${escapeHtml(responseType.replaceAll("_", " "))}
        </span>
    `;
}

function renderLocationInfo(location) {
    if (!location) return "";
    const place = location.formattedAddress || [location.area, location.city, location.district, location.state, location.country].filter(Boolean).join(", ");
    const accuracy = Number(location.accuracy);
    return `<div class="location-result"><strong>📍 ${escapeHtml(place || "Your current area")}</strong>${Number.isFinite(accuracy) && accuracy > 0 ? `<span>Accuracy: about ${escapeHtml(accuracy)} m</span>` : ""}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.latitude},${location.longitude}`)}" target="_blank" rel="noopener noreferrer">Open in Maps</a></div>`;
}

function renderAnswerQualitySafe(answerQuality) {
    if (!answerQuality) return "";

    if (!answerQuality.needsLiveVerification && answerQuality.hasDatabaseResult !== false) {
        return "";
    }

    const note = answerQuality.needsLiveVerification
        ? "Some details may change. Please verify with official/latest sources."
        : "This answer may use general AI knowledge because no strong saved database result was found.";

    return `
        <div class="answer-quality-note">
            ${escapeHtml(note)}
        </div>
    `;
}

function renderTripMetaSafe(data) {
    const chips = [];

    if (data.budget) chips.push(`Budget: ₹${data.budget}`);
    if (data.peopleCount && data.peopleCount > 1) chips.push(`${data.peopleCount} people`);

    if (!chips.length) return "";

    return `
        <div class="trip-meta-row">
            ${chips.map(x => `<span>${escapeHtml(x)}</span>`).join("")}
        </div>
    `;
}

function renderSuggestedQuestionsSafe(questions = []) {
    if (!Array.isArray(questions) || !questions.length) return "";

    return `
        <div class="suggested-questions">
            <div class="suggested-title">Ask next</div>
            <div class="suggested-row">
                ${questions.slice(0, 4).map(q => `
                    <button type="button" onclick="usePrompt('${escapeAttr(q)}')">
                        ${escapeHtml(q)}
                    </button>
                `).join("")}
            </div>
        </div>
    `;
}

function renderKnowledgeCardsSafe(results = [], primaryResult = null, responseType = "knowledge_card") {
    const cards = Array.isArray(results) && results.length
        ? results
        : primaryResult
            ? [primaryResult]
            : [];

    if (!cards.length) return "";

    return `
        <div class="knowledge-results ${escapeAttr(responseType)}">
            ${cards.slice(0, 5).map((item) => {
        const title = item.title || item.name || "Kerala knowledge";
        const type = item.type || item.intent || "Kerala";
        const district = item.district || item.region || "";
        const desc = item.description || "";
        const knownFor = Array.isArray(item.knownFor) ? item.knownFor : [];
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const extra = item.extra || {};

        const bornDied = [extra.born, extra.died].filter(Boolean).join(" – ");

        const knownForHtml = knownFor.length
            ? `
                        <div class="knowledge-mini-section">
                            <div class="knowledge-mini-title">Known for</div>
                            <div class="knowledge-chip-row">
                                ${knownFor.slice(0, 5).map(x => `
                                    <span class="knowledge-chip">${escapeHtml(x)}</span>
                                `).join("")}
                            </div>
                        </div>
                    `
            : "";

        const docs = Array.isArray(extra.requiredDocuments)
            ? extra.requiredDocuments
            : [];

        const steps = Array.isArray(extra.steps)
            ? extra.steps
            : [];

        const serviceHtml = responseType === "service_guide"
            ? `
                        ${docs.length ? `
                            <div class="knowledge-mini-section">
                                <div class="knowledge-mini-title">Documents usually needed</div>
                                <ul class="knowledge-list">
                                    ${docs.slice(0, 6).map(x => `<li>${escapeHtml(x)}</li>`).join("")}
                                </ul>
                            </div>
                        ` : ""}

                        ${steps.length ? `
                            <div class="knowledge-mini-section">
                                <div class="knowledge-mini-title">Basic steps</div>
                                <ol class="knowledge-list">
                                    ${steps.slice(0, 6).map(x => `<li>${escapeHtml(x)}</li>`).join("")}
                                </ol>
                            </div>
                        ` : ""}
                    `
            : "";

        const emergencyHtml = responseType === "emergency_card"
            ? `
                        <div class="emergency-strip">
                            <span>⚠️</span>
                            <span>If there is immediate danger, call 112 first.</span>
                        </div>
                    `
            : "";

        return `
                    <div class="knowledge-card">
                        <div class="knowledge-top">
                            <div>
                                <div class="knowledge-kicker">${escapeHtml(type)}</div>
                                <div class="knowledge-title">${escapeHtml(title)}</div>
                                <div class="knowledge-meta">
                                    ${escapeHtml([district, bornDied].filter(Boolean).join(" · "))}
                                </div>
                            </div>
                            <div class="knowledge-icon">${getKnowledgeIconSafe(responseType, item.intent)}</div>
                        </div>

                        ${desc ? `<p class="knowledge-desc">${escapeHtml(desc)}</p>` : ""}

                        ${knownForHtml}
                        ${serviceHtml}
                        ${emergencyHtml}

                        ${tags.length ? `
                            <div class="knowledge-chip-row muted">
                                ${tags.slice(0, 5).map(x => `
                                    <span class="knowledge-chip">${escapeHtml(x)}</span>
                                `).join("")}
                            </div>
                        ` : ""}
                    </div>
                `;
    }).join("")}
        </div>
    `;
}

function getKnowledgeIconSafe(responseType, intent) {
    if (responseType === "service_guide") return "🏛️";
    if (responseType === "emergency_card") return "🚨";
    if (responseType === "education_guide") return "🎓";

    if (intent === "writer") return "✍️";
    if (intent === "book") return "📚";
    if (intent === "history") return "🏺";
    if (intent === "culture") return "🎭";
    if (intent === "festival") return "🎉";
    if (intent === "food_knowledge") return "🍛";

    return "🌴";
}


// =====================================================
// RENDER RESULTS
// =====================================================

function renderBigImage(media, ui) {
    if (!ui.showBigImage || !media || media.status !== "found" || !media.imageUrl) {
        return "";
    }

    return `
        <div class="cards-preview one-card">
            <div class="place-preview big-preview">
                <div class="place-preview-img"
                    style="background-image: linear-gradient(to top, rgba(0,0,0,0.5), transparent), url('${escapeAttr(media.imageUrl)}')">
                </div>

                <div class="place-preview-body">
                    <div class="place-preview-title">${escapeHtml(media.title || "Image result")}</div>
                    <div class="place-preview-meta">Destination image</div>
                </div>
            </div>
        </div>
    `;
}

function renderSmartCards(cards, ui) {
    if (!ui.showCards || !cards.length) return "";

    if (ui.cardMode === "osm_service_cards") {
        return renderServiceCards(cards);
    }

    return renderPlaceCards(cards, ui);
}

function renderPremiumResults({ responseType, ui, placeCards, knowledgeResults, primaryResult }) {
    if (
        responseType === "knowledge_card" ||
        responseType === "service_guide" ||
        responseType === "emergency_card" ||
        responseType === "education_guide"
    ) {
        return renderKnowledgeCards(knowledgeResults, primaryResult, responseType);
    }

    return renderSmartCards(placeCards, ui);
}

function renderKnowledgeCards(results = [], primaryResult = null, responseType = "knowledge_card") {
    const cards = results.length ? results : (primaryResult ? [primaryResult] : []);

    if (!cards.length) return "";

    return `
        <div class="knowledge-results ${responseType}">
            ${cards.slice(0, 5).map((item) => {
        const title = item.title || item.name || "Kerala knowledge";
        const type = item.type || item.intent || "Kerala";
        const district = item.district || item.region || "";
        const desc = item.description || "";
        const knownFor = Array.isArray(item.knownFor) ? item.knownFor : [];
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const extra = item.extra || {};

        const knownForHtml = knownFor.length
            ? `
                        <div class="knowledge-mini-section">
                            <div class="knowledge-mini-title">Known for</div>
                            <div class="knowledge-chip-row">
                                ${knownFor.slice(0, 5).map(x => `<span class="knowledge-chip">${escapeHtml(x)}</span>`).join("")}
                            </div>
                        </div>
                    `
            : "";

        const serviceDocs = Array.isArray(extra.requiredDocuments)
            ? extra.requiredDocuments
            : [];

        const serviceSteps = Array.isArray(extra.steps)
            ? extra.steps
            : [];

        const serviceHtml = responseType === "service_guide"
            ? `
                        ${serviceDocs.length ? `
                            <div class="knowledge-mini-section">
                                <div class="knowledge-mini-title">Documents usually needed</div>
                                <ul class="knowledge-list">
                                    ${serviceDocs.slice(0, 6).map(x => `<li>${escapeHtml(x)}</li>`).join("")}
                                </ul>
                            </div>
                        ` : ""}

                        ${serviceSteps.length ? `
                            <div class="knowledge-mini-section">
                                <div class="knowledge-mini-title">Basic steps</div>
                                <ol class="knowledge-list">
                                    ${serviceSteps.slice(0, 6).map(x => `<li>${escapeHtml(x)}</li>`).join("")}
                                </ol>
                            </div>
                        ` : ""}
                    `
            : "";

        const emergencyHtml = responseType === "emergency_card"
            ? `
                        <div class="emergency-strip">
                            <span>⚠️</span>
                            <span>If there is immediate danger, call 112 first.</span>
                        </div>
                    `
            : "";

        const bornDied = [extra.born, extra.died].filter(Boolean).join(" – ");

        return `
                    <div class="knowledge-card">
                        <div class="knowledge-top">
                            <div>
                                <div class="knowledge-kicker">${escapeHtml(type)}</div>
                                <div class="knowledge-title">${escapeHtml(title)}</div>
                                <div class="knowledge-meta">
                                    ${escapeHtml([district, bornDied].filter(Boolean).join(" · "))}
                                </div>
                            </div>
                            <div class="knowledge-icon">${getKnowledgeIcon(responseType, item.intent)}</div>
                        </div>

                        ${desc ? `<p class="knowledge-desc">${escapeHtml(desc)}</p>` : ""}

                        ${knownForHtml}
                        ${serviceHtml}
                        ${emergencyHtml}

                        ${tags.length ? `
                            <div class="knowledge-chip-row muted">
                                ${tags.slice(0, 5).map(x => `<span class="knowledge-chip">${escapeHtml(x)}</span>`).join("")}
                            </div>
                        ` : ""}
                    </div>
                `;
    }).join("")}
        </div>
    `;
}

function getKnowledgeIcon(responseType, intent) {
    if (responseType === "service_guide") return "🏛️";
    if (responseType === "emergency_card") return "🚨";
    if (responseType === "education_guide") return "🎓";

    if (intent === "writer") return "✍️";
    if (intent === "book") return "📚";
    if (intent === "history") return "🏺";
    if (intent === "culture") return "🎭";
    if (intent === "festival") return "🎉";
    if (intent === "food_knowledge") return "🍛";

    return "🌴";
}

function renderSuggestedQuestions(questions = []) {
    if (!questions.length) return "";

    return `
        <div class="suggested-questions">
            <div class="suggested-title">Ask next</div>
            <div class="suggested-row">
                ${questions.slice(0, 4).map(q => `
                    <button type="button" onclick="usePrompt('${escapeAttr(q)}')">
                        ${escapeHtml(q)}
                    </button>
                `).join("")}
            </div>
        </div>
    `;
}

function renderResponseBadge(responseType, intent) {
    const label = responseType || intent;
    if (!label || label === "text") return "";

    const clean = label.replaceAll("_", " ");

    return `<span class="response-badge">${escapeHtml(clean)}</span>`;
}

function renderAnswerQuality(answerQuality) {
    if (!answerQuality) return "";

    if (!answerQuality.needsLiveVerification && answerQuality.hasDatabaseResult !== false) {
        return "";
    }

    const note = answerQuality.needsLiveVerification
        ? "Some details may change. Please verify with official/latest sources."
        : "This answer may use general AI knowledge because no strong saved database result was found.";

    return `
        <div class="answer-quality-note">
            ${escapeHtml(note)}
        </div>
    `;
}

function renderTripMeta(data) {
    const chips = [];

    if (data.budget) chips.push(`Budget: ₹${data.budget}`);
    if (data.peopleCount && data.peopleCount > 1) chips.push(`${data.peopleCount} people`);

    if (!chips.length) return "";

    return `
        <div class="trip-meta-row">
            ${chips.map(x => `<span>${escapeHtml(x)}</span>`).join("")}
        </div>
    `;
}
function renderServiceCards(cards) {
    return `
        <div class="service-results">
            ${cards.slice(0, 6).map((p) => {
        const title = p.name || "Service result";

        const meta = [
            p.type,
            p.region,
            p.address
        ].filter(Boolean).join(" · ");

        const phone = p.phone
            ? `<span class="service-chip">📞 ${escapeHtml(p.phone)}</span>`
            : "";

        const hours = p.openingHours
            ? `<span class="service-chip">🕒 ${escapeHtml(p.openingHours)}</span>`
            : "";

        const distance = p.distanceKm
            ? `<span class="service-chip">📍 ${Number(p.distanceKm).toFixed(1)} km</span>`
            : "";

        const source = p.source
            ? `<span class="service-chip">${escapeHtml(p.source)}</span>`
            : "";

        const encodedPlace = encodeURIComponent(JSON.stringify([p]));

        const mapBtn = hasLatLng(p)
            ? `
                        <button 
                            type="button"
                            class="mini-map-btn" 
                            onclick='event.stopPropagation(); showEncodedPlacesOnMap("${encodedPlace}", "${escapeAttr(title)}")'
                        >
                            <span>🗺️</span>
                            <span>View map</span>
                        </button>
                    `
            : "";

        return `
                    <div class="service-result-card" onclick="selectResultCard('${escapeAttr(p.id || "")}')">
                        <div class="service-result-title">${escapeHtml(title)}</div>
                        <div class="service-result-meta">${escapeHtml(meta || p.description || "Service location")}</div>
                        <div class="service-chip-row">${distance}${phone}${hours}${source}</div>
                        ${mapBtn}
                    </div>
                `;
    }).join("")}
        </div>
    `;
}
function renderPlaceCards(cards, ui) {
    if (!cards.length) return "";

    const limit =
        ui.cardMode === "compact_place_with_image" ||
            ui.cardMode === "image_result"
            ? 1
            : 6;

    return `
        <div class="cards-preview ${limit === 1 ? "one-card" : ""}">
            ${cards.slice(0, limit).map((p) => {
        const image = p.imageUrl || p.wikiImage || "";
        const title = p.name || "Kerala result";

        const meta = [
            p.region,
            p.bestTime,
            p.rating ? `${Number(p.rating).toFixed(1)}★` : ""
        ].filter(Boolean).join(" · ");

        const encodedPlace = encodeURIComponent(JSON.stringify([p]));

        const mapBtn = hasLatLng(p)
            ? `
                        <button 
                            type="button"
                            class="mini-map-btn" 
                            onclick='event.stopPropagation(); showEncodedPlacesOnMap("${encodedPlace}", "${escapeAttr(title)}")'
                        >
                            <span>🗺️</span>
                            <span>View map</span>
                        </button>
                    `
            : "";

        const imageHtml = image
            ? `
                        <div class="place-preview-img"
                            style="background-image: linear-gradient(to top, rgba(0,0,0,0.5), transparent), url('${escapeAttr(image)}')">
                        </div>
                    `
            : `
                        <div class="place-preview-img no-image">
                            <span>🌴</span>
                        </div>
                    `;

        return `
                    <div class="place-preview ${limit === 1 ? "big-preview" : ""}" onclick="selectResultCard('${escapeAttr(p.id || "")}')">
                        ${imageHtml}

                        <div class="place-preview-body">
                            <div class="place-preview-title">${escapeHtml(title)}</div>
                            <div class="place-preview-meta">${escapeHtml(meta || p.description || "Kerala result")}</div>
                            ${mapBtn}
                        </div>
                    </div>
                `;
    }).join("")}
        </div>
    `;
}

function renderMapActionButton(places = [], shouldShow = false) {
    if (!shouldShow || !places.length) return "";

    const encodedPlaces = encodeURIComponent(JSON.stringify(places));

    return `
        <div class="map-action-wrap">
            <button 
                type="button"
                class="map-action-btn" 
                onclick='showEncodedPlacesOnMap("${encodedPlaces}", "Places from Octopus AI")'
            >
                <span>🗺️</span>
                <span>View results on map</span>
            </button>
        </div>
    `;
}

function showEncodedPlacesOnMap(encodedPlaces, title = "Places from Octopus AI") {
    try {
        const places = JSON.parse(decodeURIComponent(encodedPlaces));
        showPlacesOnMap(places, title);
    } catch (e) {
        console.error("Failed to open map places:", e);
    }
}


// =====================================================
// DISPLAY RULES
// =====================================================

function shouldShowImageCards(userMessage, data) {
    const msg = (userMessage || "").toLowerCase();

    const serviceIntent = data?.ui?.cardMode === "osm_service_cards";

    if (serviceIntent) {
        return Array.isArray(data.matchedPlaces) && data.matchedPlaces.length > 0;
    }

    const cardKeywords = [
        "image",
        "photo",
        "show",
        "place",
        "places",
        "visit",
        "trip",
        "plan",
        "tour",
        "beach",
        "hill",
        "waterfall",
        "fort",
        "munnar",
        "wayanad",
        "kochi",
        "kozhikode",
        "idukki",
        "kerala",
        "best",
        "top",
        "suggest",
        "recommend"
    ];

    const userNeedsCards = cardKeywords.some(word => msg.includes(word));

    const hasValidPlaces =
        data &&
        Array.isArray(data.matchedPlaces) &&
        data.matchedPlaces.length > 0;

    return userNeedsCards && hasValidPlaces;
}

function shouldShowBigImage(userMessage, media, ui) {
    const msg = userMessage.toLowerCase();

    const imageKeywords = [
        "image",
        "photo",
        "picture",
        "pic",
        "show image",
        "show photo",
        "show me",
        "look like",
        "view"
    ];

    const userAskedImage = imageKeywords.some(word => msg.includes(word));

    return (
        userAskedImage &&
        ui.showBigImage &&
        media &&
        media.status === "found" &&
        media.imageUrl
    );
}

function shouldShowCardsByResponseType(userMessage, data) {
    const responseType = data.responseType || data?.ui?.cardMode || "";
    const cardMode = data?.ui?.cardMode || "";

    if (
        responseType === "knowledge_card" ||
        responseType === "service_guide" ||
        responseType === "emergency_card" ||
        responseType === "education_guide"
    ) {
        return Array.isArray(data.results) && data.results.length > 0;
    }

    if (cardMode === "osm_service_cards" || responseType === "service_cards") {
        return Array.isArray(data.matchedPlaces) && data.matchedPlaces.length > 0;
    }

    return shouldShowImageCards(userMessage, data);
}

function selectResultCard(id) {
    if (!id) return;

    currentPlaceId = id;
    octopusInput.value = "Explain this";

    autoGrowInput();
    octopusInput.focus();
}


// =====================================================
// LOCATION
// =====================================================

function classifyWebIntent(query = "") {
    const q = query.toLowerCase().trim();
    const hasHere = /\b(near me|nearby|around me|from here|where am i|my location|show my location|here|closest|nearest|current location)\b/.test(q);
    if (/\b(where am i|show my location|my current location|where i am)\b/.test(q)) return { type: "LOCATION_SELF", needsLocation: true };
    if (/\b(weather here|rain here|weather near me|rain near me)\b/.test(q)) return { type: "LOCAL_WEATHER", needsLocation: true };
    if (/\b(news (here|near me|around me)|what.?s happening (here|around me))\b/.test(q)) return { type: "LOCAL_NEWS", needsLocation: true };
    if (/\b(how far|distance)\b/.test(q) && (hasHere || /\bi\b/.test(q))) return { type: "DISTANCE", needsLocation: true };
    if (/\b(directions?|route|how (do|can) i reach|navigate)\b/.test(q) && (hasHere || /\b(to|reach)\b/.test(q))) return { type: "DIRECTIONS", needsLocation: true };
    if (hasHere && /\b(restaurant|hotel|hospital|pharmacy|cafe|atm|fuel|petrol|station|beach|tourist|shop|parking|charging|place|food|biriyani)\b/.test(q)) return { type: "NEARBY", needsLocation: true };
    if (/\b(latest|today|current|currently|this week|news|weather|train status|ksrtc)\b/.test(q)) return { type: "GENERAL_WEB", needsLocation: false };
    return { type: "NO_LOCATION_REQUIRED", needsLocation: false };
}

async function getLocationPermissionState() {
    if (!navigator.geolocation) return "unavailable";
    if (!navigator.permissions || !navigator.permissions.query) return "unknown";
    try {
        const status = await navigator.permissions.query({ name: "geolocation" });
        locationPermissionState = status.state;
        status.onchange = () => { locationPermissionState = status.state; renderLocationState(); };
        return status.state;
    } catch (_) { return "unknown"; }
}

function normalizeLocation(position, geocode = {}) {
    const a = geocode.address || {};
    const area = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.village || a.town || a.city || "";
    const city = a.city || a.town || a.municipality || a.village || "";
    const location = {
        latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy || 0), timestamp: position.timestamp || Date.now(),
        formattedAddress: geocode.display_name || [area, city, a.county, a.state, a.country].filter(Boolean).join(", "),
        house: a.house_number || a.building || "", road: a.road || "", neighbourhood: a.neighbourhood || "",
        suburb: a.suburb || "", village: a.village || "", town: a.town || "", city,
        municipality: a.municipality || "", district: a.state_district || a.county || "",
        state: a.state || "", postcode: a.postcode || "", country: a.country || "", area,
        source: "browser_gps"
    };
    return location;
}

async function reverseGeocode(position) {
    const { latitude: lat, longitude: lng } = position.coords;
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&addressdetails=1`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("Reverse geocoding unavailable");
        return await response.json();
    } catch (error) { debugEvent("reverse-geocode-failed", { message: error.message }); return {}; }
}

function applyUserLocation(location, state = "LOCATION_GRANTED") {
    userLocation = location; userLat = location.latitude; userLng = location.longitude;
    userLocationText = location.formattedAddress || [location.area, location.city, location.state, location.country].filter(Boolean).join(", ") || "Approximate current location";
    locationState = state;
    sessionStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(location));
    renderLocationState();
}

function loadLocationCache() {
    try {
        const cached = JSON.parse(sessionStorage.getItem(LOCATION_CACHE_KEY) || "null");
        if (cached && cached.timestamp && Date.now() - cached.timestamp < LOCATION_CACHE_MS) applyUserLocation(cached);
    } catch (_) {}
}

function getCurrentUserLocation({ refresh = false } = {}) {
    if (locationRequestPromise) return locationRequestPromise;
    if (!navigator.geolocation) { locationState = "LOCATION_UNAVAILABLE"; renderLocationState(); return Promise.resolve(null); }
    if (!refresh && userLocation && Date.now() - userLocation.timestamp < LOCATION_CACHE_MS) return Promise.resolve(userLocation);
    locationState = "LOCATION_REQUESTING"; renderLocationState();
    locationRequestPromise = new Promise(resolve => navigator.geolocation.getCurrentPosition(async position => {
        const location = normalizeLocation(position, await reverseGeocode(position));
        applyUserLocation(location); resolve(location);
    }, error => {
        locationState = error.code === error.PERMISSION_DENIED ? "LOCATION_DENIED" : "LOCATION_UNAVAILABLE";
        locationPermissionState = error.code === error.PERMISSION_DENIED ? "denied" : locationPermissionState;
        renderLocationState(); resolve(null);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: refresh ? 0 : LOCATION_CACHE_MS }));
    return locationRequestPromise.finally(() => { locationRequestPromise = null; });
}

function renderLocationPermissionDialog(query) {
    return new Promise(resolve => {
        document.getElementById("locationDialog")?.remove();
        const el = document.createElement("div"); el.id = "locationDialog"; el.className = "location-dialog-backdrop";
        el.innerHTML = `<section class="location-dialog" role="dialog" aria-modal="true" aria-labelledby="locationDialogTitle"><div class="location-dialog-icon">📍</div><h2 id="locationDialogTitle">Use your location?</h2><p>Octopus AI can use your current location for nearby places, directions, local recommendations, and more accurate answers. It is only used for this request.</p><div class="location-dialog-actions"><button class="location-allow">Allow location</button><button class="location-secondary">Not now</button></div><button class="location-manual">Use a location instead</button></section>`;
        document.body.appendChild(el);
        el.querySelector(".location-allow").onclick = () => { el.remove(); resolve("allow"); };
        el.querySelector(".location-secondary").onclick = () => { el.remove(); resolve("skip"); };
        el.querySelector(".location-manual").onclick = () => { el.remove(); resolve("manual"); };
    });
}

function requestManualLocation() {
    const place = window.prompt("Enter a city, district, landmark, or postcode:", userLocationText || "");
    if (!place || !place.trim()) return false;
    userLocation = { formattedAddress: place.trim(), area: place.trim(), source: "manual", timestamp: Date.now() };
    userLat = null; userLng = null; userLocationText = place.trim(); locationState = "LOCATION_MANUAL"; renderLocationState(); return true;
}

async function ensureLocationForQuery(query, intent) {
    if (userLocation && userLocation.source === "browser_gps" && Date.now() - userLocation.timestamp >= LOCATION_CACHE_MS) locationState = "LOCATION_EXPIRED";
    if (userLocation && locationState !== "LOCATION_EXPIRED" && !/where am i now|update my location/.test(query.toLowerCase())) return userLocation;
    const permission = await getLocationPermissionState();
    if (permission === "denied") {
        locationState = "LOCATION_DENIED"; renderLocationState();
        if (!sessionStorage.getItem(LOCATION_DENIAL_NOTICE_KEY)) {
            sessionStorage.setItem(LOCATION_DENIAL_NOTICE_KEY, "1");
            requestManualLocation();
        }
        return null;
    }
    if (permission === "granted") return getCurrentUserLocation({ refresh: true });
    const choice = await renderLocationPermissionDialog(query);
    if (choice === "manual") { requestManualLocation(); return null; }
    if (choice !== "allow") { updateDockNote("Location not used · you can enter a place any time"); return null; }
    const location = await getCurrentUserLocation({ refresh: /where am i now|update my location/.test(query.toLowerCase()) });
    if (!location && locationState === "LOCATION_DENIED" && !sessionStorage.getItem(LOCATION_DENIAL_NOTICE_KEY)) {
        sessionStorage.setItem(LOCATION_DENIAL_NOTICE_KEY, "1"); requestManualLocation();
    }
    return location;
}

function buildLocationContext() {
    if (!userLocation) return { available: false, permissionState: locationPermissionState, state: locationState };
    const { latitude, longitude, accuracy, timestamp, formattedAddress, area, city, district, state, country, source } = userLocation;
    return { available: true, permissionState: locationPermissionState, state: locationState, latitude, longitude, accuracyMeters: accuracy, timestamp, formattedAddress, area, city, district, state, country, source };
}

function renderLocationState() {
    const labels = { LOCATION_REQUESTING: "📍 Getting your location…", LOCATION_GRANTED: `📍 Using your location${userLocationText ? `: ${userLocationText}` : ""}`, LOCATION_DENIED: "📍 Location access is off · use a place instead", LOCATION_UNAVAILABLE: "📍 Location unavailable · use a place instead", LOCATION_MANUAL: `📍 Using manual location: ${userLocationText}`, LOCATION_LIVE: "📍 Live location is active" };
    updateDockNote(labels[locationState] || "Puter AI · Private Kerala tools");
}

function startLiveLocation() {
    if (!navigator.geolocation || liveLocationWatcher !== null) return;
    liveLocationWatcher = navigator.geolocation.watchPosition(async p => applyUserLocation(normalizeLocation(p, await reverseGeocode(p)), "LOCATION_LIVE"), () => { locationState = "LOCATION_UNAVAILABLE"; renderLocationState(); }, { enableHighAccuracy: true, maximumAge: 5000 });
    locationState = "LOCATION_LIVE"; renderLocationState();
}
function stopLiveLocation() { if (liveLocationWatcher !== null) navigator.geolocation.clearWatch(liveLocationWatcher); liveLocationWatcher = null; locationState = userLocation ? "LOCATION_GRANTED" : "LOCATION_UNKNOWN"; renderLocationState(); }

function updateDockNote(text) {
    const note = document.querySelector(".dock-note");
    if (note) note.textContent = text;
}



// =====================================================
// MAP
// =====================================================

function isMapQuestion(message = "") {
    const msg = message.toLowerCase();

    const mapWords = [
        "map",
        "route",
        "direction",
        "directions",
        "near me",
        "nearby",
        "location",
        "distance",
        "how to reach",
        "navigate"
    ];

    return mapWords.some(word => msg.includes(word));
}

function hasLatLng(place) {
    return (
        place &&
        (place.lat ?? place.latitude) !== undefined &&
        (place.lng ?? place.lon ?? place.longitude) !== undefined &&
        (place.lat ?? place.latitude) !== null &&
        (place.lng ?? place.lon ?? place.longitude) !== null &&
        !isNaN(Number(place.lat ?? place.latitude)) &&
        !isNaN(Number(place.lng ?? place.lon ?? place.longitude))
    );
}

function initOctopusMap(lat, lng) {
    if (!window.L) {
        console.error("Leaflet is not loaded. Add Leaflet CDN in HTML.");
        return;
    }

    if (!octopusMap) {
        octopusMap = L.map("octopusMap").setView([lat, lng], 13);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap"
        }).addTo(octopusMap);
    }

    setTimeout(() => {
        octopusMap.invalidateSize();
    }, 250);
}

function clearMapMarkers() {
    mapMarkers.forEach(marker => marker.remove());
    mapMarkers = [];
}

function showPlacesOnMap(places = [], title = "Places on map") {
    const mapPanel = document.getElementById("mapPanel");
    const mapTitle = document.getElementById("mapTitle");

    if (!mapPanel || !mapTitle) {
        console.error("Map panel HTML not found.");
        return;
    }

    const validPlaces = places.filter(hasLatLng);

    if (!validPlaces.length && !(Number.isFinite(Number(userLat)) && Number.isFinite(Number(userLng)))) {
        updateDockNote("Choose a place before opening the map");
        return;
    }

    mapPanel.classList.remove("hidden");
    mapTitle.textContent = title;

    const firstPlace = validPlaces[0];

    const centerLat = firstPlace ? Number(firstPlace.lat) : Number(userLat);
    const centerLng = firstPlace ? Number(firstPlace.lng) : Number(userLng);

    initOctopusMap(centerLat, centerLng);
    clearMapMarkers();

    const bounds = [];

    validPlaces.forEach(place => {
        const lat = Number(place.lat ?? place.latitude);
        const lng = Number(place.lng ?? place.lon ?? place.longitude);

        const marker = L.marker([lat, lng]).addTo(octopusMap);

        const placeName = escapeHtml(place.name || "Place");
        const placeMeta = escapeHtml(place.address || place.district || place.region || "");
        const routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;

        marker.bindPopup(`
            <div style="min-width:190px">
                <strong>${placeName}</strong><br>
                <span>${placeMeta}</span><br><br>
                <a target="_blank" href="${routeUrl}">
                    Open Route
                </a>
            </div>
        `);

        mapMarkers.push(marker);
        bounds.push([lat, lng]);
    });

    if (Number.isFinite(Number(userLat)) && Number.isFinite(Number(userLng))) {
        const userMarker = L.circleMarker([userLat, userLng], {
            radius: 8,
            fillOpacity: 1
        }).addTo(octopusMap);

        userMarker.bindPopup("You are here");
        mapMarkers.push(userMarker);
        if (userLocation && Number.isFinite(Number(userLocation.accuracy)) && userLocation.accuracy > 0) {
            mapMarkers.push(L.circle([userLat, userLng], { radius: userLocation.accuracy, color: "#43e2e6", weight: 1, fillOpacity: 0.08 }).addTo(octopusMap));
        }
        bounds.push([userLat, userLng]);
    }

    if (bounds.length > 1) {
        octopusMap.fitBounds(bounds, { padding: [45, 45] });
    } else {
        octopusMap.setView([centerLat, centerLng], 12);
    }

    setTimeout(() => {
        mapPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
}

function closeMapPanel() {
    const mapPanel = document.getElementById("mapPanel");
    if (mapPanel) mapPanel.classList.add("hidden");
}


// =====================================================
// HELPERS
// =====================================================

function scrollCanvasBottom() {
    requestAnimationFrame(() => {
        if (!canvasArea) return;

        canvasArea.scrollTo({
            top: canvasArea.scrollHeight,
            behavior: "smooth"
        });
    });
}

function formatReply(text) {
    return escapeHtml(text || "")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
}

function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

let pendingPuterMessage = null;

function showPuterLoginPopup(message = null) {
    pendingPuterMessage = message;

    const modal = document.getElementById("puterLoginModal");

    if (!modal) {
        console.error("Puter login modal not found.");
        return;
    }

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");

    document.body.classList.add("puter-modal-open");

    setTimeout(() => {
        const button = document.getElementById("puterSignInButton");
        if (button) button.focus();
    }, 50);
}


function closePuterLoginPopup() {
    const modal = document.getElementById("puterLoginModal");

    if (!modal) return;

    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");

    document.body.classList.remove("puter-modal-open");
}


async function signInToPuter() {
    const button = document.getElementById("puterSignInButton");

    if (button) {
        button.disabled = true;
        button.innerHTML = `
            <span>Opening Puter sign in…</span>
            <span>↗</span>
        `;
    }

    try {
        if (typeof puter === "undefined" || !puter.auth) {
            throw new Error("Puter.js is not loaded.");
        }

        await puter.auth.signIn();

        const signedIn = await puter.auth.isSignedIn();

        if (!signedIn) {
            throw new Error("Puter sign-in was not completed.");
        }

        closePuterLoginPopup();

        updatePuterLoginState();

        // Continue the message that originally triggered login.
        if (pendingPuterMessage) {
            const message = pendingPuterMessage;
            pendingPuterMessage = null;

            // Put the message back into the input.
            octopusInput.value = message;
            autoGrowInput();

            // Continue sending.
            setTimeout(() => {
                sendOctopusMessage();
            }, 150);
        }

    } catch (error) {
        console.error("Puter sign-in failed:", error);

        if (button) {
            button.disabled = false;
            button.innerHTML = `
                <span>Try Puter sign in again</span>
                <span>→</span>
            `;
        }

        alert(
            "Puter sign-in could not be completed. " +
            "Please try again."
        );
    }
}


async function updatePuterLoginState() {
    const buttons = document.querySelectorAll("[data-puter-auth]");

    if (!buttons.length) return;

    let signedIn = false;

    try {
        if (typeof puter !== "undefined" && puter.auth) {
            signedIn = await puter.auth.isSignedIn();
        }
    } catch (error) {
        console.warn("Puter login check failed:", error);
    }

    buttons.forEach((button) => {
        if (signedIn) {
            button.innerHTML = `
                <span class="puter-status-dot"></span>
                <span>Connected</span>
            `;

            button.classList.add("signed-in");
            button.title = "Puter connected";
        } else {
            button.innerHTML = `
                <span>Sign in</span>
            `;

            button.classList.remove("signed-in");
            button.title = "Sign in with Puter";
        }
    });
}
async function handlePuterAuthButton() {
    try {
        if (typeof puter === "undefined" || !puter.auth) {
            showPuterLoginPopup();
            return;
        }

        const signedIn = await puter.auth.isSignedIn();
        if (!signedIn) showPuterLoginPopup();
    } catch (error) {
        console.error("Puter auth check failed:", error);
        showPuterLoginPopup();
    }
}

// =====================================================
// START APP
// =====================================================

document.addEventListener("DOMContentLoaded", async () => {
    initChatSessions();
    getLocationPermissionState().then(() => { loadLocationCache(); renderLocationState(); });
    startAutoRipples();

    // Puter.js is external; update status after it loads, and retry briefly if needed.
    updatePuterLoginState();
    [500, 1200, 2500, 5000].forEach(delay => setTimeout(updatePuterLoginState, delay));
});
