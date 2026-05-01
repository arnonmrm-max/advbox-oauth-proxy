import { chromium, Page } from "playwright";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

// Pega o session.json da raiz do projeto
const SESSION_PATH = join(process.cwd(), "session.json");
const SERVER = process.env.CHATGURU_SERVER || "17";

/**
 * Espera X milissegundos
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Faz o web scraping do histórico de mensagens de um chat no ChatGuru.
 * Retorna as mensagens em formato texto otimizado para o Gemini ler.
 */
export async function scrapeChatHistory(chatId: string): Promise<string> {
  if (!existsSync(SESSION_PATH)) {
    throw new Error(`Sessão não encontrada em ${SESSION_PATH}. É necessário gerar o session.json antes de rodar o scraper.`);
  }

  const session = JSON.parse(await readFile(SESSION_PATH, "utf-8"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: session, permissions: ["notifications"] });
  const page = await context.newPage();

  try {
    const chatUrl = `https://s${SERVER}.expertintegrado.app/chats#${chatId}`;
    console.log(`[Scraper] Acessando chat: ${chatUrl}`);
    
    await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(5000); // Aguarda o carregamento do SPA do ChatGuru

    // Se redirecionou para o login, a sessão expirou
    if (page.url().includes("login") || page.url().includes("signin")) {
      throw new Error("A sessão (cookies) do ChatGuru expirou. É necessário fazer login novamente.");
    }

    // Aguarda o container de mensagens renderizar
    await page.waitForSelector("#chat_messages_app", { timeout: 15000 }).catch(() => null);
    await sleep(2000);

    // Removemos modais chatos (ex: Beamer) que bloqueiam a tela
    await page.evaluate(() => {
      const beamer = document.querySelector("#beamerPushModal");
      if (beamer) beamer.remove();
      document.querySelectorAll(".modal.show, .modal.active, [role='dialog'].active").forEach(el => el.remove());
      document.querySelectorAll(".modal-backdrop, .push-overlay").forEach(el => el.remove());
    });

    // Fazemos SCROLL PARA CIMA para garantir que carregamos mensagens suficientes da conversa
    for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
      const chatContainer = await page.$("#chat_messages_app");
      if (chatContainer) {
        const box = await chatContainer.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + 50);
          await page.mouse.wheel(0, -3000);
        }
      }
      await sleep(1500);
    }

    // Extrai o conteúdo
    const chatHistoryText = await page.evaluate(() => {
      let resultText = "";
      let currentDate = "";
      const container = document.querySelector("#chat_messages_app > div");
      if (!container) return "";

      for (const child of container.children) {
        if (child.classList.contains("msg-data")) {
          currentDate = child.textContent?.trim() || "";
          resultText += `\n[--- ${currentDate} ---]\n`;
          continue;
        }
        
        if (!child.classList.contains("row_msg")) continue;

        const msgContainer = child.querySelector(".msg-container");
        if (!msgContainer) continue;

        const isOutgoing = msgContainer.classList.contains("bg-sent-msg");
        const remetente = isOutgoing ? "Escritório" : "Cliente";
        
        const textEl = msgContainer.querySelector("span.msg-contentT") as HTMLElement;
        let texto = textEl?.innerText?.trim() || "";

        if (!texto) {
          if (msgContainer.querySelector("audio")) texto = "[Áudio enviado]";
          else if (msgContainer.querySelector("img")) texto = "[Imagem enviada]";
          else if (msgContainer.querySelector("a.file-download")) texto = "[Arquivo Documento enviado]";
          else continue;
        }

        const timeEl = msgContainer.querySelector("span.msg-timestamp");
        const horario = timeEl?.textContent?.trim() || "";

        resultText += `[${horario}] ${remetente}: ${texto}\n`;
      }
      
      return resultText;
    });

    await browser.close();
    
    if (!chatHistoryText.trim()) {
      return "Nenhuma mensagem encontrada neste chat ou o chat está vazio.";
    }

    return chatHistoryText;

  } catch (error: any) {
    await browser.close().catch(() => {});
    throw new Error(`Falha no scraper: ${error.message}`);
  }
}
