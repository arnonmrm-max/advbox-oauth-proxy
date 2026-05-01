import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
// Initialize the Gemini SDK. It will automatically use process.env.GEMINI_API_KEY if present, 
// but we pass it explicitly if we have it to be safe.
const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

/**
 * Envia o histórico do chat para o Gemini e pede um resumo processual objetivo.
 */
export async function generateSummary(chatHistory: string): Promise<string> {
  if (!apiKey && !process.env.GEMINI_API_KEY) {
    throw new Error("A variável de ambiente GEMINI_API_KEY não está configurada.");
  }

  const prompt = `Você é um assistente jurídico sênior do escritório Lima Amorim & Advogados.
Sua missão é ler o histórico de um atendimento via WhatsApp e criar um resumo clínico, direto e focado no andamento processual para ser salvo no software ADVBOX.

REGRAS DO RESUMO:
1. Seja direto (máximo 4 linhas).
2. Destaque o motivo do contato do cliente.
3. Destaque quais providências foram tomadas pelo atendente ou o que ficou pendente (ex: "Falta enviar RG").
4. Não use saudações, vá direto ao ponto.
5. Se não houver assunto jurídico na conversa (ex: apenas um "bom dia"), responda: "Contato de rotina sem andamento processual relevante."

HISTÓRICO DO ATENDIMENTO:
${chatHistory}

RESUMO PARA O ADVBOX:`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro", // Modelo mais inteligente para análise jurídica complexa
      contents: prompt,
    });
    
    return response.text || "Erro: IA não retornou texto.";
  } catch (error: any) {
    throw new Error(`Falha ao gerar resumo com Gemini: ${error.message}`);
  }
}
