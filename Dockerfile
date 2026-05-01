# Usamos a imagem oficial do Playwright (traz todas as fontes e libs do Chrome)
FROM mcr.microsoft.com/playwright:v1.50.0-jammy

WORKDIR /app

# Instala dependências do Node
COPY package*.json ./
RUN npm install

# Copia o código e a sessão secreta
COPY . .

# Compila o TypeScript
RUN npm run build

# Configurações de porta
ENV PORT=4000
ENV NODE_ENV=production
EXPOSE 4000

# Inicia o servidor
CMD ["npm", "start"]

