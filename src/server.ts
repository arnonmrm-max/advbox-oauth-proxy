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

// ─── ADVBOX REST API (app.advbox.com.br) ──────────────────────────────────────
const ADVBOX_REST_URL   = process.env.ADVBOX_REST_URL   || "https://app.advbox.com.br/api/v1";
const ADVBOX_REST_TOKEN = process.env.ADVBOX_REST_TOKEN || "4aganI4V9kABSyo6jHGlDbhyN9mcYwTbIQU8tu2oDsNyuoi6RLKplLZ3kIE3";

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

// ─── 6b. HELPER — chama a API REST oficial do Advbox ─────────────────────────
async function callAdvboxRest(method: string, path: string, body?: Record<string, unknown>) {
  const r = await fetch(`${ADVBOX_REST_URL}/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${ADVBOX_REST_TOKEN}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return { data: [] };
  return r.json();
}

// ─── 6c. HELPER — envia WhatsApp via ChatGuru ─────────────────────────────────
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

  // ── CLIENTES ──────────────────────────────────────────────────────────────
  { name: "list_customers",
    description: "Lista clientes do escritório. Filtre por nome, telefone, email ou cidade.",
    inputSchema: { type: "object", properties: {
      name:{type:"string"}, phone:{type:"string"}, email:{type:"string"},
      city:{type:"string"}, limit:{type:"number"}, offset:{type:"number"},
    }}},

  { name: "get_customer",
    description: "Retorna todos os dados de um cliente pelo ID, incluindo telefone, email, CPF/CNPJ e origem.",
    inputSchema: { type: "object", required: ["customer_id"], properties: {
      customer_id:{type:"number"},
    }}},

  { name: "search_customers",
    description: "Busca clientes por nome ou termo livre.",
    inputSchema: { type: "object", properties: {
      query:{type:"string"}, name:{type:"string"},
    }}},

  { name: "create_customer",
    description: "Cria um novo cliente no Advbox.",
    inputSchema: { type: "object", required: ["users_id","customers_origins_id","name"], properties: {
      users_id:{type:"number", description:"ID do advogado responsável"},
      customers_origins_id:{type:"number", description:"ID da origem (use get_origins para listar)"},
      name:{type:"string"}, email:{type:"string"}, phone:{type:"string"},
      document:{type:"string", description:"CPF ou CNPJ (apenas números)"},
      identification:{type:"string", description:"RG"},
      birthdate:{type:"string", description:"Data de nascimento (YYYY-MM-DD)"},
    }}},

  // ── PROCESSOS ─────────────────────────────────────────────────────────────
  { name: "list_lawsuits",
    description: "Lista processos. Filtre por número, cliente, responsável, grupo ou fase.",
    inputSchema: { type: "object", properties: {
      name:{type:"string"}, process_number:{type:"string"},
      customer_id:{type:"number"}, responsible_id:{type:"number"},
      group_id:{type:"number", description:"ID do grupo/área (ex: JUDICIAL, RECURSAL)"},
      limit:{type:"number"}, offset:{type:"number"},
    }}},

  { name: "get_lawsuit",
    description: "Retorna todos os dados de um processo: fase, andamentos (notes), clientes, tipo, responsável e valores.",
    inputSchema: { type: "object", required: ["lawsuit_id"], properties: {
      lawsuit_id:{type:"number"},
    }}},

  { name: "search_lawsuits",
    description: "Busca processos por nome, número ou termo livre.",
    inputSchema: { type: "object", properties: {
      query:{type:"string"}, name:{type:"string"},
    }}},

  { name: "create_lawsuit",
    description: "Cria um novo processo no Advbox.",
    inputSchema: { type: "object", required: ["users_id","customers_id","stages_id","type_lawsuits_id"], properties: {
      users_id:{type:"number", description:"ID do advogado responsável"},
      customers_id:{type:"array", items:{type:"number"}, description:"IDs dos clientes (partes do processo)"},
      stages_id:{type:"number", description:"ID da fase inicial (use get_stages para listar)"},
      type_lawsuits_id:{type:"number", description:"ID do tipo de processo (use get_type_lawsuits para listar)"},
      folder:{type:"string", description:"Número da pasta (ex: PROC 000001)"},
      process_number:{type:"string", description:"Número do processo judicial"},
      protocol_number:{type:"string", description:"Número de protocolo"},
      date:{type:"string", description:"Data do processo (YYYY-MM-DD)"},
      notes:{type:"string", description:"Notas e andamentos iniciais"},
    }}},

  { name: "update_lawsuit",
    description: "Atualiza fase, responsável, tipo ou dados gerais de um processo. Para acrescentar andamentos use add_andamento.",
    inputSchema: { type: "object", required: ["lawsuit_id"], properties: {
      lawsuit_id:{type:"number"},
      stages_id:{type:"number", description:"Novo estágio/fase (use get_stages para listar IDs)"},
      users_id:{type:"number", description:"Novo advogado responsável"},
      type_lawsuits_id:{type:"number", description:"Novo tipo de processo"},
      process_number:{type:"string"}, protocol_number:{type:"string"},
      folder:{type:"string"}, date:{type:"string", description:"YYYY-MM-DD"},
      notes:{type:"string", description:"Substitui todo o campo de notas — prefira add_andamento para preservar histórico"},
    }}},

  { name: "create_movement",
    description: "Adiciona um andamento processual MANUAL na timeline oficial de movimentações do processo no Advbox. Use para registrar qualquer movimentação: petição protocolada, decisão recebida, audiência realizada, despacho, sentença, etc. Este é o método correto para adicionar andamentos visíveis na aba Movimentações do processo.",
    inputSchema: { type: "object", required: ["lawsuit_id","description"], properties: {
      lawsuit_id:  { type: "number", description: "ID interno do processo no Advbox" },
      description: { type: "string", description: "Descrição do andamento (mínimo 10 caracteres)" },
      date:        { type: "string", description: "Data do andamento em DD/MM/YYYY. Se omitida usa hoje." },
    }}},

  { name: "list_movements",
    description: "Lista todas as movimentações (andamentos processuais) de um processo, incluindo as do tribunal e as manuais.",
    inputSchema: { type: "object", required: ["lawsuit_id"], properties: {
      lawsuit_id: { type: "number" },
      origin:     { type: "string", description: "TRIBUNAL ou MANUAL" },
    }}},

  { name: "list_history",
    description: "Lista o histórico de tarefas realizadas em um processo.",
    inputSchema: { type: "object", required: ["lawsuit_id"], properties: {
      lawsuit_id: { type: "number" },
      status:     { type: "string", description: "pending | completed | all" },
    }}},

  { name: "list_publications",
    description: "Lista publicações do Diário de Justiça de um processo (intimações, sentenças, despachos capturados automaticamente).",
    inputSchema: { type: "object", required: ["lawsuit_id"], properties: {
      lawsuit_id: { type: "number" },
    }}},

  { name: "list_last_movements",
    description: "Lista as últimas movimentações de todos os processos do escritório.",
    inputSchema: { type: "object", properties: {
      limit: { type: "number" }, offset: { type: "number" },
    }}},

  { name: "get_customer_birthdays",
    description: "Lista clientes aniversariantes do mês. Útil para campanhas de relacionamento.",
    inputSchema: { type: "object", properties: {
      month: { type: "number", description: "Mês 1-12. Omitir = mês atual." },
      limit: { type: "number" }, offset: { type: "number" },
    }}},

  { name: "add_andamento",
    description: "Registra um andamento nas notas gerais do processo. Para adicionar na timeline oficial de movimentações use create_movement.",
    inputSchema: { type: "object", required: ["lawsuit_id","descricao"], properties: {
      lawsuit_id:{type:"number"},
      descricao:{type:"string", description:"Descrição do andamento"},
    }}},

  // ── FINANCEIRO ────────────────────────────────────────────────────────────
  { name: "list_transactions",
    description: "Lista transações financeiras. Filtre por data de pagamento, data de vencimento ou processo.",
    inputSchema: { type: "object", properties: {
      date_payment_start:{type:"string", description:"YYYY-MM-DD"},
      date_payment_end:{type:"string", description:"YYYY-MM-DD"},
      date_due_start:{type:"string", description:"Data de vencimento início (YYYY-MM-DD)"},
      date_due_end:{type:"string", description:"Data de vencimento fim (YYYY-MM-DD)"},
      lawsuit_id:{type:"number"}, limit:{type:"number"}, offset:{type:"number"},
    }}},

  { name: "get_transaction",
    description: "Retorna detalhes de uma transação financeira pelo ID.",
    inputSchema: { type: "object", required: ["transaction_id"], properties: {
      transaction_id:{type:"number"},
    }}},

  // ── TAREFAS ───────────────────────────────────────────────────────────────
  { name: "list_tasks",
    description: "Lista tarefas e compromissos. Filtre por período, usuário, processo ou tipo de tarefa.",
    inputSchema: { type: "object", properties: {
      date_start:{type:"string", description:"YYYY-MM-DD"},
      date_end:{type:"string", description:"YYYY-MM-DD"},
      user_id:{type:"number"}, lawsuit_id:{type:"number"},
      task_id:{type:"number", description:"ID do tipo de tarefa"},
      limit:{type:"number"}, offset:{type:"number"},
    }}},

  { name: "create_task",
    description: "Cria uma tarefa ou compromisso vinculado a um processo.",
    inputSchema: { type: "object", required: ["from","guests","tasks_id","lawsuits_id","start_date"], properties: {
      from:{type:"number", description:"ID do usuário que criou a tarefa"},
      guests:{type:"array", items:{type:"number"}, description:"IDs dos usuários responsáveis pela tarefa"},
      tasks_id:{type:"number", description:"ID do tipo de tarefa (use get_settings para listar)"},
      lawsuits_id:{type:"number", description:"ID do processo vinculado"},
      start_date:{type:"string", description:"Data de início (YYYY-MM-DD)"},
      start_time:{type:"string", description:"Hora de início (HH:MM)"},
      end_date:{type:"string", description:"Data de término (YYYY-MM-DD)"},
      end_time:{type:"string", description:"Hora de término (HH:MM)"},
      date_deadline:{type:"string", description:"Prazo fatal (YYYY-MM-DD)"},
      comments:{type:"string", description:"Observações da tarefa"},
      local:{type:"string", description:"Local do compromisso"},
      urgent:{type:"boolean", description:"Marcar como urgente"},
      important:{type:"boolean", description:"Marcar como importante"},
    }}},

  // ── CONFIGURAÇÕES / LISTAS ────────────────────────────────────────────────
  { name: "get_settings",      description: "Retorna configurações do sistema: contas bancárias, categorias financeiras, tipos de tarefa, centros de custo.", inputSchema: { type: "object", properties: {} } },
  { name: "get_users",         description: "Lista todos os usuários e advogados do escritório com seus IDs.", inputSchema: { type: "object", properties: {} } },
  { name: "get_origins",       description: "Lista origens de captação de clientes (Google, Instagram, Indicação etc.) com IDs.", inputSchema: { type: "object", properties: {} } },
  { name: "get_stages",        description: "Lista todas as fases/estágios de processos com IDs, organizados por pipeline (Judicial, Recursal, Marketing etc.).", inputSchema: { type: "object", properties: {} } },
  { name: "get_type_lawsuits", description: "Lista todos os tipos de processo com IDs, organizados por área (Imobiliário, Bancário, Família etc.).", inputSchema: { type: "object", properties: {} } },
  { name: "get_users_rewards", description: "Retorna pontuação e ranking de produtividade da equipe. Filtre por data.", inputSchema: { type: "object", properties: { date:{type:"string", description:"Mês de referência (YYYY-MM)"} } } },

  // ── WHATSAPP (ChatGuru) ───────────────────────────────────────────────────
  { name: "send_whatsapp",
    description: "Envia mensagem WhatsApp para um cliente via ChatGuru. Use para enviar andamentos, avisos de audiência, confirmações e atualizações de processos.",
    inputSchema: { type: "object", required: ["phone","message"], properties: {
      phone:{type:"string", description:"Número com DDI+DDD (ex: 5527999999999 para (27) 99999-9999)"},
      message:{type:"string", description:"Texto da mensagem"},
      send_date:{type:"string", description:"Agendamento opcional (YYYY-MM-DD HH:MM)"},
    }}},
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

      // ── add_andamento — lê notes atual, acrescenta e salva ───────────────
      if (name === "add_andamento") {
        const { lawsuit_id, descricao } = args as Record<string, any>;
        if (!lawsuit_id || !descricao) {
          return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "lawsuit_id e descricao são obrigatórios" } });
        }

        // 1. Lê o processo para pegar notes atual
        const lawsuit: any = await callAdvbox("get_lawsuit", { lawsuit_id });
        const notesAtual: string = lawsuit.notes || "";

        // 2. Formata a nova linha de andamento com data de hoje
        const hoje = new Date().toLocaleDateString("pt-BR");
        const novaLinha = `Andamento: Data: ${hoje} - Descrição: ${descricao}`;

        // 3. Acrescenta ao histórico existente
        const notesNovo = notesAtual
          ? `${notesAtual}\n${novaLinha}`
          : novaLinha;

        // 4. Salva no processo
        const resultado: any = await callAdvbox("update_lawsuit", { lawsuit_id, notes: notesNovo });
        return res.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify({ andamento_registrado: novaLinha, resultado }, null, 2) }] },
        });
      }

      // ── create_movement — andamento na timeline oficial via API REST ─────────
      if (name === "create_movement") {
        const { lawsuit_id, description, date } = args as Record<string, any>;
        if (!lawsuit_id || !description) {
          return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "lawsuit_id e description são obrigatórios" } });
        }
        // Formata data como DD/MM/YYYY (exigido pela API)
        const dateStr = date || new Date().toLocaleDateString("pt-BR");
        const data = await callAdvboxRest("POST", "lawsuits/movement", {
          lawsuit_id,
          description,
          date: dateStr,
        });
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      }

      // ── list_movements ────────────────────────────────────────────────────
      if (name === "list_movements") {
        const { lawsuit_id, origin } = args as Record<string, any>;
        const qs = origin ? `?origin=${origin}` : "";
        const data = await callAdvboxRest("GET", `movements/${lawsuit_id}${qs}`);
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      }

      // ── list_history ──────────────────────────────────────────────────────
      if (name === "list_history") {
        const { lawsuit_id, status } = args as Record<string, any>;
        const qs = status ? `?status=${status}` : "";
        const data = await callAdvboxRest("GET", `history/${lawsuit_id}${qs}`);
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      }

      // ── list_publications ─────────────────────────────────────────────────
      if (name === "list_publications") {
        const { lawsuit_id } = args as Record<string, any>;
        const data = await callAdvboxRest("GET", `publications/${lawsuit_id}`);
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      }

      // ── list_last_movements ───────────────────────────────────────────────
      if (name === "list_last_movements") {
        const { limit = 50, offset = 0 } = args as Record<string, any>;
        const data = await callAdvboxRest("GET", `last_movements?limit=${limit}&offset=${offset}`);
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      }

      // ── get_customer_birthdays ────────────────────────────────────────────
      if (name === "get_customer_birthdays") {
        const { month, limit = 100, offset = 0 } = args as Record<string, any>;
        const qs = month ? `?month=${month}&limit=${limit}&offset=${offset}` : `?limit=${limit}&offset=${offset}`;
        const data = await callAdvboxRest("GET", `customers/birthdays${qs}`);
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      }

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

// ─── 9. WEBHOOK CHATGURU → ADVBOX ────────────────────────────────────────────
// Recebe eventos do ChatGuru e registra andamento no processo mais antigo do cliente
app.post("/webhook/chatguru", async (req, res) => {
  try {
    const body = req.body;

    // Extrai campos do payload ChatGuru
    const phone: string    = (body.celular || body.phone || body.chat_number || "").replace(/\D/g, "");
    const nome: string     = body.nome || body.name || "Cliente";
    const mensagem: string = body.texto_mensagem || body.message || body.text || "";
    const linkChat: string = body.link_chat || "";
    const responsavel: string = body.responsavel_nome || "";
    const chatCreated: string = body.chat_created || new Date().toISOString();

    // Tags: aceita array ["CLIENTE ATIVO"] ou string "CLIENTE ATIVO, OUTRO"
    const tagsRaw = body.tags || "";
    const tags: string[] = Array.isArray(tagsRaw)
      ? tagsRaw.map((t: string) => t.toUpperCase().trim())
      : String(tagsRaw).toUpperCase().split(/[,;]/).map((t: string) => t.trim());

    // ── FILTRO: só processa contatos com tag CLIENTE ATIVO ────────────────
    const TAG_REQUERIDA = "CLIENTE ATIVO";
    if (!tags.includes(TAG_REQUERIDA)) {
      console.log(`[webhook] Ignorado — ${nome} (${phone}) não tem tag "${TAG_REQUERIDA}". Tags: ${tags.join(", ") || "nenhuma"}`);
      return res.status(200).json({ status: "ignorado", motivo: `tag "${TAG_REQUERIDA}" ausente`, tags });
    }

    if (!phone) {
      return res.status(400).json({ error: "Número de telefone não encontrado no payload" });
    }

    // 1. Busca cliente no Advbox pelo telefone (tenta com e sem DDI 55)
    let customer: any = null;
    const phoneVariants = [phone, phone.replace(/^55/, ""), `55${phone}`];

    for (const p of phoneVariants) {
      const result: any = await callAdvboxRest("GET", `customers?phone=${p}&limit=5`);
      if (result?.data?.length > 0) {
        customer = result.data[0];
        break;
      }
    }

    if (!customer) {
      console.log(`[webhook] Cliente não encontrado para telefone ${phone}`);
      return res.status(200).json({ status: "cliente_nao_encontrado", phone });
    }

    // 2. Busca todos os processos do cliente
    const lawsuitsResult: any = await callAdvboxRest("GET", `lawsuits?customer_id=${customer.id}&limit=100`);
    const lawsuits: any[] = lawsuitsResult?.data || [];

    if (lawsuits.length === 0) {
      return res.status(200).json({ status: "sem_processos", customer: customer.name });
    }

    // 3. Pega o processo mais antigo (menor process_date ou created_at)
    const sorted = lawsuits.sort((a: any, b: any) => {
      const da = new Date(a.process_date || a.created_at || "9999").getTime();
      const db = new Date(b.process_date || b.created_at || "9999").getTime();
      return da - db;
    });
    const processo = sorted[0];

    // 4. Monta descrição do andamento
    const hoje = new Date().toLocaleDateString("pt-BR");
    let descricao = `Contato via WhatsApp em ${hoje}`;
    if (mensagem) descricao += `: ${mensagem.substring(0, 300)}`;
    if (responsavel) descricao += ` [Atendente: ${responsavel}]`;
    if (linkChat) descricao += ` | Chat: ${linkChat}`;

    // Garante mínimo de 10 caracteres
    if (descricao.length < 10) descricao = `Contato via WhatsApp em ${hoje} — Nova conversa iniciada`;

    // 5. Registra andamento no processo mais antigo
    const movement = await callAdvboxRest("POST", "lawsuits/movement", {
      lawsuit_id:  processo.id,
      date:        hoje.split("/").join("/"), // já está em DD/MM/YYYY
      description: descricao,
    });

    console.log(`[webhook] Andamento registrado | Cliente: ${customer.name} | Processo: ${processo.folder || processo.id} | ${descricao.substring(0, 80)}`);

    return res.status(200).json({
      status:    "ok",
      customer:  customer.name,
      processo:  processo.folder || processo.process_number || String(processo.id),
      stage:     processo.stage,
      andamento: descricao,
      resultado: movement,
    });

  } catch (err: any) {
    console.error("[webhook] Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── 9. HEALTH ────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "healthy", tools: TOOLS.length }));

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Advbox OAuth+MCP Proxy em ${PUBLIC_URL}`);
  console.log(`   Adicione no Claude.ai: ${PUBLIC_URL}/mcp\n`);
});
