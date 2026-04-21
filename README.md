# Shop AI

Web app privada para restilizar imagens de produtos com Gemini 2.5 Flash Image (Nano Banana). Concebida para o workflow: carregas imagens do Temu/AliExpress/Amazon, escolhes o preset da tua marca, recebes imagens com a estética consistente da loja.

V1: apenas o motor de imagem. Scraping de marketplaces e push para Shopify ficam para V2/V3.

---

## Setup rápido (5 minutos)

### 1. Instalar dependências

```bash
npm install
```

### 2. Criar `.env.local`

Copia o exemplo e preenche:

```bash
cp .env.example .env.local
```

Edita `.env.local`:

```
GOOGLE_AI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxx
APP_PASSWORD=escolhe_uma_password
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
```

- `GOOGLE_AI_API_KEY` — cria em [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- `APP_PASSWORD` — password simples para aceder à app (só tu)
- `GEMINI_IMAGE_MODEL` — `gemini-2.5-flash-image` (Nano Banana, barato) ou `gemini-3-pro-image-preview` (Pro, maior qualidade)

### 3. Correr

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Login com a password que escolheste.

---

## Como usar

1. Arrasta imagens de produto para a caixa de upload (ou clica para selecionar)
2. Para cada imagem, escolhe o role: `hero` (shot principal), `detail` (close-up), `lifestyle` (uso/contexto)
3. No painel direito: escolhe o preset de marca e a coleção
4. Em "Notas do produto" podes acrescentar detalhes (opcional): material, cor, tipo
5. Clica "Processar". Cada imagem demora 10-20 segundos
6. Vê resultados lado a lado com os originais. Download individual.

---

## Sistema de prompts

Cada imagem recebe um prompt composto de 4 camadas:

1. **Base da marca** — estética fixa da loja (`base_prompt` no preset)
2. **Coleção** — contexto/mood específico (`collection_presets[key]`)
3. **Role** — tipo de shot: hero, detail ou lifestyle (`image_roles[role]`)
4. **Produto** — notas opcionais inseridas pelo utilizador

Mais o **negative prompt** (coisas a evitar).

O prompt final é enviado ao Gemini com a imagem original como input. O modelo edita a imagem mantendo o produto e aplicando o estilo.

---

## Adicionar um novo preset

Cria um ficheiro `presets/minha-marca.json` seguindo o formato dos existentes:

```json
{
  "id": "minha-marca",
  "name": "A Minha Marca",
  "description": "Descrição curta",
  "base_prompt": "...",
  "collection_presets": {
    "general": "..."
  },
  "image_roles": {
    "hero": "...",
    "detail": "...",
    "lifestyle": "..."
  },
  "negative": "..."
}
```

Aparece automaticamente no dropdown ao reiniciar o servidor.

---

## Deploy para Vercel

### Via GitHub (recomendado)

1. Cria um repositório no GitHub e faz push deste projeto:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/teu-user/shop-ai.git
   git push -u origin main
   ```
2. Em [vercel.com/new](https://vercel.com/new), importa o repositório
3. Em "Environment Variables", adiciona as três variáveis do `.env.local`
4. Deploy

### Via Vercel CLI

```bash
npm i -g vercel
vercel
```

Segue as instruções. Depois adiciona as env vars no dashboard do Vercel e faz redeploy.

---

## Estrutura

```
shop-ai/
├── presets/                   JSONs de preset por marca
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          Password gate
│   │   │   ├── presets/       Lista presets para UI
│   │   │   └── process/       Chama Gemini
│   │   ├── login/             Página de login
│   │   ├── layout.tsx
│   │   ├── page.tsx           Dashboard principal
│   │   └── globals.css
│   ├── components/            UI React
│   ├── lib/
│   │   ├── gemini.ts          SDK wrapper
│   │   └── prompt-engine.ts   Composição hierárquica
│   ├── types/                 TypeScript types
│   └── middleware.ts          Auth middleware
├── .env.example
├── package.json
└── README.md
```

---

## Custo estimado

Gemini 2.5 Flash Image: **~$0.039 por imagem gerada**.
Tier grátis da Google AI Studio: ~1500 pedidos/dia.

Para 100 produtos × 6 imagens = 600 imagens = ~$24 em modo pago, ou 0 custo dentro do tier grátis (espalhando por 1 dia).

---

## Próximos passos (V2)

- Chrome Extension para extrair produtos de Temu/AliExpress/Amazon
- Push automático para Shopify via client credentials
- Histórico de importações em SQLite ou Supabase
- UI para editar presets directamente na app
