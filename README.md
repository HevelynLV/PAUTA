# PAUTA

Marketplace de imóveis exclusivos em Florianópolis. O proprietário dá 6 meses de exclusividade ao PAUTA; imobiliárias e corretores autônomos assinantes acessam o catálogo, pedem visitas, enviam propostas e fecham a venda, com o contrato assinado fora do app e conferido pelo admin.

Stack: Next.js (App Router, TypeScript), Supabase (Postgres, Auth, Storage), Tailwind CSS, Vercel, Asaas (cobrança) e WhatsApp (avisos).

Documentos do projeto:
- **[docs/visao-geral.md](docs/visao-geral.md):** ideia, regras do negócio, usuários, requisitos e decisões. É a fonte da verdade: em caso de dúvida, vale o que está lá
- **[ROADMAP.md](ROADMAP.md):** onde o projeto parou, o próximo passo e as etapas do MVP. Leia "Onde paramos" e "Atenção" antes de qualquer tarefa
- **[docs/prompts.md](docs/prompts.md):** os prompts para usar com o Claude Code em cada etapa, na ordem, do abrir ao fechar a etapa
- **[docs/prototipo/](docs/prototipo/):** as telas do protótipo (celular e site). A versão clicável fica em https://claude.ai/artifact/GBqYuzenozHgGygiGrSS12
- **[CLAUDE.md](CLAUDE.md):** as instruções que o Claude Code segue no repositório

> **Situação atual:** o projeto está na Etapa 1 (setup). Veja "Onde paramos" no [ROADMAP.md](ROADMAP.md). Os passos marcados com *(a partir da Etapa N)* só valem depois que essa etapa for feita.

## Como começar a trabalhar no PAUTA

Checklist para quem chega no projeto. Faça na ordem, uma vez por computador.

### 1. Acessos

- [ ] Convite como colaborador no GitHub, no repositório `HevelynLV/PAUTA` *(a partir da Etapa 1)*. Quem já está no projeto envia em Settings → Collaborators. Aceite pelo e-mail ou em github.com/notifications
- [ ] Convite no Supabase *(a partir da Etapa 1)*: quem já está no projeto envia em **Organization → Members → Invite**. Aceite pelo e-mail e confira que o projeto do PAUTA aparece no seu painel. O ID do projeto é `zqvwyjcdjfkovtiwdryo`

> **O banco é compartilhado.** Todos usam o mesmo projeto do Supabase. O que uma pessoa aplica no banco vale para a outra na hora. Combine antes de mexer no banco.

### 2. Instalar as ferramentas

Comandos para Windows (PowerShell). Em Mac, use os links.

- [ ] **Node.js** (versão LTS, 20 ou mais nova): `winget install OpenJS.NodeJS.LTS` · [nodejs.org](https://nodejs.org)
- [ ] **Git**: `winget install Git.Git` · [git-scm.com](https://git-scm.com). Depois configure seu nome e e-mail (os mesmos do GitHub):
  ```bash
  git config --global user.name "Seu Nome"
  git config --global user.email "seu-email@exemplo.com"
  ```
- [ ] **VS Code**: `winget install Microsoft.VisualStudioCode` · [code.visualstudio.com](https://code.visualstudio.com)
- [ ] **Claude Code**: `irm https://claude.ai/install.ps1 | iex` (Mac: `curl -fsSL https://claude.ai/install.sh | bash`). Feche e abra o terminal e rode `claude` para fazer login
- [ ] **Plugin Superpowers** (usado pelo `/auditar-etapa`). Dentro do Claude Code, rode:
  ```
  /plugin marketplace add obra/superpowers-marketplace
  /plugin install superpowers@superpowers-marketplace
  ```
  Feche e abra o Claude Code depois de instalar

Confira: `node -v`, `git --version` e `claude --version` respondem sem erro.

### 3. Baixar o projeto *(a partir da Etapa 1)*

- [ ] Clonar o repositório e instalar as dependências:
  ```bash
  git clone https://github.com/HevelynLV/PAUTA.git
  cd PAUTA
  npm install
  ```
- [ ] Baixar o navegador dos testes automáticos (uma vez por computador):
  ```bash
  npx playwright install chromium
  ```

### 4. Criar o `.env.local` *(a partir da Etapa 1)*

- [ ] Crie o arquivo `.env.local` na raiz do projeto (mesma pasta do `package.json`):

  ```
  NEXT_PUBLIC_SUPABASE_URL=https://<id-do-projeto>.supabase.co
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
  SITE_URL=http://localhost:3000
  SUPABASE_SECRET_KEY=sb_secret_...
  ```

  | Variável | O que é | Onde pegar no painel do Supabase |
  |---|---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | Endereço do projeto, só `https://<id>.supabase.co`, sem barra e sem `/rest/v1/` no fim | **Project Settings → Data API → Project URL** (ou botão **Connect** no topo do painel). Cuidado: o painel também mostra o endereço da API REST, que termina em `/rest/v1/`; esse não serve |
  | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública do app; pode ir para o navegador porque o RLS protege os dados | **Project Settings → API Keys → Publishable key** |
  | `SITE_URL` | Endereço do site, usado nos links dos e-mails de cadastro e de recuperação de senha. Sem barra no fim | Não vem do painel: em desenvolvimento é sempre `http://localhost:3000` |
  | `SUPABASE_SECRET_KEY` | Chave secreta, para os testes automáticos e para o "Excluir" de assinante pendente na tela do admin (só no servidor) | **Project Settings → API Keys → Secret keys → Add new secret key**, com o nome `testes-e2e-<seu nome>`. Copie o valor (`sb_secret_...`) |

  > ⚠️ **A secret key é pessoal.** Cada pessoa cria a sua; não compartilhe. Ela ignora todo o RLS: quem tem a chave lê e apaga qualquer dado do banco. Por isso ela **nunca** tem o prefixo `NEXT_PUBLIC_`, no app só é lida por `src/lib/supabase/admin.ts` (que tem `server-only` e só roda no servidor, depois de `exigirTipo("admin")`), nunca vai para a Vercel e **nunca vai para o GitHub** (o `.gitignore` ignora `.env*`). Se vazar, revogue-a no mesmo lugar onde criou. Desde o passo 5.2, em desenvolvimento o servidor do app usa esta chave pessoal para excluir assinante pendente com o usuário; sem ela, o "Excluir" da tela de assinantes dá erro. Na Vercel (Etapa 13) vai outra chave secreta, de produção, diferente das chaves pessoais (decisão de 22/10/2026).

- [ ] As variáveis do Asaas e do WhatsApp entram aqui nas Etapas 10 e 11
- [ ] Sempre que criar ou mudar o `.env.local`, pare e rode de novo o `npm run dev`. O Next.js só lê esse arquivo quando o servidor inicia
- [ ] Confira a conexão: rode `npm run dev` e abra http://localhost:3000/teste-conexao. As três linhas precisam aparecer com ✅ (essa página de teste existe até a Etapa 13)

### 5. Banco de dados *(a partir da Etapa 2)*

As migrations são aplicadas pelo terminal, com a Supabase CLI (`npx supabase`, já instalada pelo `npm install`). A CLI guarda no banco quais migrations já rodaram, então nenhuma roda duas vezes. Decidido em 20/10/2026.

**Preparação (uma vez por computador):**
- [ ] Entrar na sua conta do Supabase pelo terminal (abre o navegador para você autorizar):
  ```bash
  npx supabase login
  ```
- [ ] Ligar a pasta do projeto ao banco do PAUTA. O comando pede a **senha do banco** (Project Settings → Database → Database password; se ninguém souber, quem é dono do projeto pode redefinir ali). Digite no terminal: a senha não vai para nenhum arquivo do repositório e não deve ser colada no chat
  ```bash
  npx supabase link --project-ref zqvwyjcdjfkovtiwdryo
  ```
- [ ] Conferir que funcionou: a lista abaixo aparece sem erro (vazia enquanto não houver migration)
  ```bash
  npx supabase migration list
  ```

**Regras do banco:**
- Toda mudança no banco vira um arquivo novo em `supabase/migrations/`, nunca só no painel. Correção é sempre uma migration NOVA, nunca edição de uma que já rodou
- **Sempre `git pull` antes** de criar ou aplicar uma migration. Se o banco tiver uma migration que você não tem, o `db push` dá erro de propósito: faça o `git pull` e tente de novo
- Criar uma migration: `npx supabase migration new <nome>` (ex.: `npx supabase migration new perfis`). A CLI cria o arquivo com data e hora no nome, o que garante a ordem
- Aplicar no banco: `npx supabase db push`. Antes de confirmar, ele mostra quais migrations vai aplicar: leia a lista
- Ver o que já foi aplicado: `npx supabase migration list` (coluna Local = repositório, Remote = banco)
- Depois de aplicar, rode o `supabase/testes/testar_rls.sql` inteiro no SQL Editor do painel: toda linha tem que mostrar "✅ passou". Só então siga para o próximo passo
- Migration nova entra no "Atenção" e na lista "Migrations aplicadas no banco" do Roadmap, para avisar a outra pessoa
- **Nunca rode `npx supabase config push`.** O `supabase/config.toml` serve só para rodar o Supabase no próprio computador; esse comando copiaria essa configuração por cima da do projeto compartilhado (Site URL, login, e-mails)
- **Nunca rode `npx supabase db reset --linked`**: ele apaga e recria o banco compartilhado inteiro. E `npx supabase db push --include-all` (aplica migrations mais antigas que a última aplicada) só com a outra pessoa sabendo

### 6. Configuração do Supabase (só conferir) *(a partir da Etapa 3)*

Configurado uma vez no projeto compartilhado. Confira, sem mudar nada sem combinar:

- [ ] **Authentication → Sign In / Providers → Email → Confirm email**: **desligado** durante o desenvolvimento. Os testes automáticos usam e-mails `@exemplo.com`, que não existem. A confirmação é religada na Etapa 13, com SMTP próprio
- [ ] **Authentication → URL Configuration**:
  - Site URL: `http://localhost:3000`
  - Redirect URLs: `http://localhost:3000/**` (os links dos e-mails voltam para `/auth/confirmar`)
- [ ] **Authentication → Emails**: o modelo padrão (em inglês). Trocar pelo modelo em português de `supabase/modelos-email/` só é possível com SMTP próprio (Etapa 13). Até lá, o link de "esqueci minha senha" só funciona se for aberto **no mesmo navegador** em que foi pedido, e o e-mail só chega para quem é da equipe do projeto Supabase

Todo mundo roda o app na porta 3000, porque o Site URL é um só para o projeto.

### 7. Criar uma conta de admin para testar *(a partir da Etapa 3)*

O admin nunca é criado pelo cadastro do app.

- [ ] Rode `npm run dev` e crie uma conta como **Proprietário** com o seu e-mail
- [ ] No painel do Supabase, abra o **SQL Editor**, cole o `supabase/scripts/criar_admin.sql`, troque `<email>` pelo e-mail dessa conta e clique em Run. Tem que aparecer 1 linha com `tipo = admin`
- [ ] **Não salve** o script com o seu e-mail (desfaça a troca antes de qualquer commit)
- [ ] Saia e entre de novo no app: você cai na área do admin

### 8. Conferir que está tudo certo *(a partir da Etapa 3)*

- [ ] `npm run dev` e abra http://localhost:3000: a página inicial do PAUTA aparece, e "Entrar" leva ao login
- [ ] Em outro terminal, `npm run test:e2e`: todos os testes passam (alguns aparecem como "skipped" de propósito). Eles precisam da `SUPABASE_SECRET_KEY` no `.env.local` (passo 4), porque criam e apagam contas `e2e-…@exemplo.com`. Se aparecer erro de "rate limit", é o limite de logins do Supabase (cerca de 30 a cada 5 minutos): espere uns minutos e rode de novo. Para ver o relatório: `npx playwright show-report`

Se algo falhar, confira primeiro o `.env.local` (passo 4) e reinicie o `npm run dev`. Se uma mudança no código ou no CSS não aparecer no navegador, pare o `npm run dev`, apague a pasta `.next/dev` (é só cache) e rode de novo.

## Fluxo de cada etapa

Uma etapa por vez, sempre numa branch própria. Nunca trabalhe direto na `main`.

1. **Atualizar:** `git checkout main` e `git pull`. Se o `package.json` mudou, rode `npm install`
2. **Ler:** "Onde paramos" e "Atenção" no Roadmap. Faça o que o "Atenção" pedir (variável nova no `.env.local`, migration nova, ferramenta nova)
3. **Criar a branch:** `git checkout -b etapa-<número>-<nome>` (ex.: `etapa-4-imovel`)
4. **Construir** com o Claude Code, em passos pequenos, testando cada passo. Toda migration nova: aplicar e rodar o `testar_rls.sql` antes de seguir. Ao terminar cada passo do [docs/prompts.md](docs/prompts.md), atualizar "Onde paramos" no Roadmap com o passo feito e o próximo, para quem parar no meio saber onde retomar
5. **Auditar numa sessão nova** do Claude Code (`/clear` ou abra outro terminal): `/auditar-etapa <número>`. A sessão nova revisa o código sem as suposições de quem escreveu
6. **Corrigir** o que vocês escolherem da auditoria e rodar `npm run test:e2e`
7. **Atualizar o Roadmap:** `/atualizar-roadmap` (sempre antes do push)
8. **Enviar:** `git push -u origin <nome-da-branch>` e abra um **Pull Request** para a `main` no GitHub. A outra pessoa revisa e aceita

Os comandos `/auditar-etapa` e `/atualizar-roadmap` ficam em `.claude/commands/`. Foram recriados na Etapa 1 a partir dos do Captador, com as regras do PAUTA.
