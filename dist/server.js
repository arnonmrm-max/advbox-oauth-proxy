"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_proxy_middleware_1 = require("http-proxy-middleware");
const crypto_1 = __importDefault(require("crypto"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ADVBOX_SSE_URL = process.env.ADVBOX_URL || "https://mcp.limaamorim.com.br";
const ADVBOX_TOKEN = process.env.ADVBOX_TOKEN || "f869c4969f2e02f9245ee6a2d12db5788d92784da6badc9bba4d1d29a2bcc03c";
const PORT = parseInt(process.env.PORT || "4000");
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
// Tokens OAuth emitidos (em memória — simples e suficiente)
const validTokens = new Set();
const authCodes = new Map();
// ─── 1. DISCOVERY ─────────────────────────────────────────────────────────────
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
        issuer: PUBLIC_URL,
        authorization_endpoint: `${PUBLIC_URL}/authorize`,
        token_endpoint: `${PUBLIC_URL}/token`,
        registration_endpoint: `${PUBLIC_URL}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
    });
});
// ─── 2. DYNAMIC CLIENT REGISTRATION ──────────────────────────────────────────
app.post("/register", (_req, res) => {
    const clientId = "advbox-claude-" + crypto_1.default.randomBytes(8).toString("hex");
    res.status(201).json({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
    });
});
// ─── 3. AUTHORIZATION ────────────────────────────────────────────────────────
app.get("/authorize", (req, res) => {
    const { redirect_uri, state, code_challenge } = req.query;
    if (!redirect_uri) {
        return res.status(400).send("redirect_uri obrigatório");
    }
    // Auto-aprova: gera code e redireciona imediatamente
    const code = crypto_1.default.randomBytes(16).toString("hex");
    authCodes.set(code, { redirect_uri, state });
    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state)
        url.searchParams.set("state", state);
    return res.redirect(url.toString());
});
// ─── 4. TOKEN EXCHANGE ────────────────────────────────────────────────────────
app.post("/token", (req, res) => {
    const { code, grant_type } = req.body;
    if (grant_type !== "authorization_code" || !code || !authCodes.has(code)) {
        return res.status(400).json({ error: "invalid_grant" });
    }
    authCodes.delete(code);
    const accessToken = crypto_1.default.randomBytes(32).toString("hex");
    validTokens.add(accessToken);
    // Limpa tokens antigos se acumular muito
    if (validTokens.size > 1000)
        validTokens.clear();
    return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 86400,
    });
});
// ─── 5. AUTH MIDDLEWARE ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    const auth = req.headers["authorization"] || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token || !validTokens.has(token)) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}
// ─── 6. PROXY → ADVBOX ───────────────────────────────────────────────────────
const proxy = (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: ADVBOX_SSE_URL,
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq) => {
            // Substitui o token do Claude pelo token do Advbox
            proxyReq.setHeader("Authorization", `Bearer ${ADVBOX_TOKEN}`);
        },
    },
});
app.use("/sse", requireAuth, proxy);
app.use("/message", requireAuth, proxy);
app.use("/execute", requireAuth, proxy);
app.use("/tools", requireAuth, proxy);
app.get("/health", (_req, res) => res.json({ status: "healthy", proxy: ADVBOX_SSE_URL }));
// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n✅ Advbox OAuth Proxy rodando em ${PUBLIC_URL}`);
    console.log(`   → Proxying para: ${ADVBOX_SSE_URL}`);
    console.log(`   → Adicione no Claude.ai: ${PUBLIC_URL}/sse\n`);
});
