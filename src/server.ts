import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ADVBOX_URL   = process.env.ADVBOX_URL   || "https://mcp.limaamorim.com.br";
const ADVBOX_TOKEN = process.env.ADVBOX_TOKEN || "f869c4969f2e02f9245ee6a2d12db5788d92784da6badc9bba4d1d29a2bcc03c";
const PORT         = parseInt(process.env.PORT || "4000");
const PUBLIC_URL   = (process.env.PUBLIC_URL  || `http://localhost:${PORT}`).replace(/\/$/, "");

// ─── CHATGURU CONFIG ──────────────────────────────────────────────────────────
const CHATGURU_URL     = process.env.CHATGURU_URL     || "https://s17.chatguru.app/api/v1";
const CHATGURU_KEY     = process.env.CHATGURU_KEY     || "BIN67XARJAKDZYJUCCG0852E7HH6GJREVBOQMHRQZMRIMQD00YJS1SVON5XXQD04";
const CHATGURU_ACCOUNT = process.env.CHATGURU_ACCOUNT || "644a7348af2b76abbc1553dd";
const CHATGURU_PHONE   = process.env.CHATGURU_PHONE   || "644a765d64007ea81fe9076f";

const validTokens = new Set<string>();
const authCodes   = new Map<string, string>();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── 1. DISCOVERY ─────────────────────────────────────────────────────────────
// Suporta tanto /.well-known/oauth-protected-resource quanto /.well-known/oauth-protected-resource/mcp
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({ resource: PUBLIC_URL, authorization_servers: [PUBLIC_URL] });
});
app.get("/.well-known/oauth-protected-resource/*", (_req, res) => {
  res.json({ resource: PUBLIC_URL, authorization_servers: [PUBLIC_URL] });
});

// Suporta tanto /.well-known/oauth-authorization-server quanto /.well-known/oauth-authorization-server/mcp
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: PUBLIC_URL,
    authorization_endpoint:  `${PUBLIC_URL}/authorize`,
    token_endpoint:          `${PUBLIC_URL}/token`,
    registration_endpoint:   `${PUBLIC_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported:    ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
});

app.get("/.well-known/oauth-authorization-server/*", (_req, res) => {
  res.json({
    issuer: PUBLIC_URL,
    authorization_endpoint:  `${PUBLIC_URL}/authorize`,
    token_endpoint:          `${PUBLIC_URL}/token`,
    registration_endpoint:   `${PUBLIC_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported:    ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
});

// ─── 2. DYNAMIC CLIENT REGISTRATION ──────────────────────────────────────────
app.post("/register", (_req, res) => {
  res.status(201).json({
    client_id: "advbox-" + crypto.randomBytes(8).toString("hex"),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

// ─── 3. AUTHORIZATION (auto-aprova) ──────────────────────────────────────────
app.get("/authorize", (req, res) => {
  const { redirect_uri, state } = req.query as Record<string, string>;
  if (!redirect_uri) return res.status(400).send("redirect_uri obrigatório");

  const code = crypto.randomBytes(16).toString("hex");
  authCodes.set(code, redirect_uri);

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return res.redirect(url.toString());
});

// ─── 4. TOKEN ─────────────────────────────────────────────────────────────────
app.post("/token", (req, res) => {
  const { code, grant_type } = req.body;
  if (grant_type !== "authorization_code" || !code || !authCodes.has(code)) {
    return res.status(400).json({ error: "invalid_grant" });
  }
  authCodes.delete(code);
  const token = crypto.randomBytes(32).toString("hex");
  validTokens.add(token);
  return res.json({ access_token: token, token_type: "Bearer", expires_in: 86400 });
});

// ─── 5. AUTH MIDDLEWARE ───────────────────────────────────────────────────────
function requireAuth(_req: express.Request, _res: express.Response, next: express.NextFunction) {
  // Sem OAuth — o token do Advbox fica protegido server-side
  // A URL do proxy é privada e só você conhece
  next();
}

// ─── 6. HELPER — chama o Advbox ──────────────────────────────────────────────
async function callAdvbox(tool: string, args: Record<string, unknown>) {
  const r = await fetch(`${ADVBOX_URL}/execute`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ADVBOX_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool, arguments: args }),
  });
  return r.json();
}

// ─── 6b. HELPER — envia WhatsApp via ChatGuru ─────────────────────────────────
async function sendWhatsApp(phone: string, message: string, send_date?: string) {
  // Normaliza o número: remove tudo que não é dígito
  const chat_number = phone.replace(/\D/g, "");
  if (!chat_number) throw new Error("Número de telefone inválido");

  const params = new URLSearchParams({
    action:     "message_send",
    text:       message,
    key:        CHATGURU_KEY,
    account_id: CHATGURU_ACCOUNT,
    phone_id:   CHATGURU_PHONE,
    chat_number,
  });
  if (send_date) params.set("send_date", send_date);

  const r = await fetch(CHATGURU_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  return r.json();
}

// ─── 7. MCP TOOLS LIST ────────────────────────────────────────────────────────
const TOOLS = [
  { name: "list_customers",    description: "Lista clientes", inputSchema: { type: "object", properties: { name:{type:"string"}, phone:{type:"string"}, email:{type:"string"}, city:{type:"string"}, limit:{type:"number"}, offset:{type:"number"} } } },
  { name: "get_customer",      description: "Detalhes de um cliente", inputSchema: { type: "object", required: ["customer_id"], properties: { customer_id:{type:"number"} } } },
  { name: "search_customers",  description: "Busca clientes por nome", inputSchema: { type: "object", properties: { query:{type:"string"}, name:{type:"string"} } } },
  { name: "create_customer",   description: "Cria cliente", inputSchema: { type: "object", required: ["users_id","customers_origins_id","name"], properties: { users_id:{type:"number"}, customers_origins_id:{type:"number"}, name:{type:"string"}, email:{type:"string"}, phone:{type:"string"} } } },
  { name: "list_lawsuits",     description: "Lista processos", inputSchema: { type: "object", properties: { name:{type:"string"}, process_number:{type:"string"}, customer_id:{type:"number"}, responsible_id:{type:"number"}, limit:{type:"number"}, offset:{type:"number"} } } },
  { name: "get_lawsuit",       description: "Detalhes de um processo", inputSchema: { type: "object", required: ["lawsuit_id"], properties: { lawsuit_id:{type:"number"} } } },
  { name: "search_lawsuits",   description: "Busca processo por nome", inputSchema: { type: "object", properties: { query:{type:"string"}, name:{type:"string"} } } },
  { name: "create_lawsuit",    description: "Cria processo", inputSchema: { type: "object", required: ["users_id","customers_id","stages_id","type_lawsuits_id"], properties: { users_id:{type:"number"}, customers_id:{type:"array",items:{type:"number"}}, stages_id:{type:"number"}, type_lawsuits_id:{type:"number"}, folder:{type:"string"}, process_number:{type:"string"} } } },
  { name: "update_lawsuit",    description: "Atualiza processo", inputSchema: { type: "object", required: ["lawsuit_id"], properties: { lawsuit_id:{type:"number"}, stages_id:{type:"number"}, notes:{type:"string"} } } },
  { name: "list_transactions", description: "Lista transações financeiras", inputSchema: { type: "object", properties: { date_payment_start:{type:"string"}, date_payment_end:{type:"string"}, lawsuit_id:{type:"number"}, limit:{type:"number"} } } },
  { name: "get_transaction",   description: "Detalhes de uma transação", inputSchema: { type: "object", required: ["transaction_id"], properties: { transaction_id:{type:"number"} } } },
  { name: "list_tasks",        description: "Lista tarefas e compromissos", inputSchema: { type: "object", properties: { date_start:{type:"string"}, date_end:{type:"string"}, user_id:{type:"number"}, lawsuit_id:{type:"number"} } } },
  { name: "create_task",       description: "Cria tarefa/compromisso", inputSchema: { type: "object", required: ["from","guests","tasks_id","lawsuits_id","start_date"], properties: { from:{type:"number"}, guests:{type:"array",items:{type:"number"}}, tasks_id:{type:"number"}, lawsuits_id:{type:"number"}, start_date:{type:"string"}, comments:{type:"string"} } } },
  { name: "get_settings",      description: "Configurações do sistema", inputSchema: { type: "object", properties: {} } },
  { name: "get_users",         description: "Lista usuários do escritório", inputSchema: { type: "object", properties: {} } },
  { name: "get_origins",       description: "Lista origens de clientes", inputSchema: { type: "object", properties: {} } },
  { name: "get_stages",        description: "Lista estágios de processos", inputSchema: { type: "object", properties: {} } },
  { name: "get_type_lawsuits", description: "Lista tipos de processo", inputSchema: { type: "object", properties: {} } },
  { name: "get_users_rewards", description: "Pontuação da equipe", inputSchema: { type: "object", properties: { date:{type:"string"} } } },

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  {
    name: "send_whatsapp",
    description: "Envia mensagem WhatsApp para um número via ChatGuru. Use para enviar andamentos, avisos e atualizações de processos aos clientes.",
    inputSchema: {
      type: "object",
      required: ["phone", "message"],
      properties: {
        phone:     { type: "string",  description: "Número do destinatário com DDI+DDD (ex: 5527999999999)" },
        message:   { type: "string",  description: "Texto da mensagem a enviar" },
        send_date: { type: "string",  description: "Agendamento opcional no formato YYYY-MM-DD HH:MM" },
      },
    },
  },
];

// ─── 8. MCP STREAMABLE HTTP ENDPOINT ─────────────────────────────────────────

// GET /mcp — Claude.ai usa para testar conectividade e SSE
app.get("/mcp", requireAuth, (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(": ping\n\n");
  const timer = setInterval(() => res.write(": ping\n\n"), 25000);
  res.on("close", () => clearInterval(timer));
});

app.post("/mcp", requireAuth, async (req, res) => {
  const body = req.body;
  const id = body.id ?? null;

  try {
    // initialize
    if (body.method === "initialize") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "advbox-mcp", version: "1.0.0" },
        },
      });
    }

    // tools/list
    if (body.method === "tools/list") {
      return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    }

    // tools/call
    if (body.method === "tools/call") {
      const { name, arguments: args = {} } = body.params || {};

      // ── WhatsApp — tratado localmente, não vai para o Advbox ──────────────
      if (name === "send_whatsapp") {
        const { phone, message, send_date } = args as Record<string, string>;
        if (!phone || !message) {
          return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "phone e message são obrigatórios" } });
        }
        const data = await sendWhatsApp(phone, message, send_date);
        return res.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] },
        });
      }

      // ── Demais ferramentas → Advbox ───────────────────────────────────────
      const data = await callAdvbox(name, args);
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        },
      });
    }

    // ping
    if (body.method === "ping") {
      return res.json({ jsonrpc: "2.0", id, result: {} });
    }

    return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });

  } catch (err: any) {
    return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: err.message } });
  }
});

// ─── 9. HEALTH ────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "healthy", tools: TOOLS.length }));

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Advbox OAuth+MCP Proxy em ${PUBLIC_URL}`);
  console.log(`   Adicione no Claude.ai: ${PUBLIC_URL}/mcp\n`);
});
