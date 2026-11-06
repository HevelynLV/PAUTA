# PAUTA — Roadmap de prompts

Última revisão: 06/11/2026

Os prompts para construir o MVP do PAUTA com o Claude Code, da Etapa 0 à Etapa 13. Siga na ordem, de cima para baixo: cada etapa usa as anteriores, e dentro de cada etapa os prompts já estão na sequência certa, do primeiro (abrir a etapa) ao último (fechar e enviar). As etapas e os critérios de "pronto" são os do [ROADMAP.md](../ROADMAP.md); as regras do produto são as da [docs/visao-geral.md](visao-geral.md).

Este arquivo é só o roteiro: ele não guarda em que passo o projeto está. Isso fica em "Onde paramos", no [ROADMAP.md](../ROADMAP.md).

## Como usar

- **Cole um prompt, teste o resultado, e só então cole o próximo.** Se um passo ficou grande demais, peça para o Claude dividir.
- **Cada etapa começa com `/clear`** (ou um terminal novo) e no **modo de planejamento**: aperte `Shift+Tab` até aparecer "plan mode". Nele o Claude lê e propõe o plano sem mexer em nada. Só saia do modo de planejamento quando concordar com o plano.
- **Ao terminar cada passo**, o Claude atualiza "Onde paramos" no `ROADMAP.md` com o passo feito e o próximo (uma linha, não o `/atualizar-roadmap` inteiro). Assim, se alguém parar no meio da etapa, a próxima sessão sabe onde retomar. A regra está no `CLAUDE.md`, por isso não aparece em cada prompt.
- **Toda etapa termina com auditoria e Roadmap atualizado:** o passo "Auditar" (`/auditar-etapa`) e o passo "Corrigir e fechar" (que roda o `/atualizar-roadmap`). Não pule nenhum dos dois.
- **A auditoria é sempre numa sessão nova** (`/clear`): quem escreveu o código tende a não ver os próprios erros.
- **Não repita o CLAUDE.md nos prompts.** O Claude Code lê o `CLAUDE.md` sozinho em toda sessão: regras de negócio, `exigirTipo()`, migrations, explicar antes do código. Por isso os prompts são curtos.
- **Decisões em aberto travam etapas.** Cada etapa diz o que precisa estar decidido antes. Se o Claude perguntar algo que ainda não foi decidido, decida com a outra pessoa, registre na Visão geral e só depois responda.
- **Se der erro**, cole o erro inteiro e peça: "Não corrija ainda: explique a causa provável e como confirmar".
- **Texto entre `<>`** é para você trocar.

---

## Antes da Etapa 1: decisões em aberto

As decisões não são do Claude, mas ele ajuda a prepará-las. Use este prompt para cada uma, numa conversa à parte:

```text
Preciso decidir <a decisão, ex.: quais filtros o catálogo terá> para o PAUTA. Leia a docs/visao-geral.md.
Me dê 2 ou 3 opções, com o impacto de cada uma no código, no custo e no piloto em Florianópolis, e a sua recomendação. Não tome a decisão por mim. Depois que eu decidir, atualize a Visão geral (tire de "Decisões em aberto", registre em "Decisões tomadas" com a data) e o CLAUDE.md.
```

| Decisão | Trava a etapa |
| --- | --- |
| ~~Como aplicar as migrations~~: decidido em 20/10/2026, `supabase db push` | 1 |
| Texto do termo de exclusividade: a Etapa 4 usa um texto provisório (decidido em 26/10/2026); o final entra antes do piloto | 13 |
| ~~Filtros do catálogo~~: decidido em 03/11/2026, tipo, bairro (vários), preço, quartos e status | 6 |
| ~~Cláusula da comissão e limite do PDF~~: decididos em 06/11/2026 (obrigatória; 20 MB) | 9 |
| % da comissão do PAUTA: não trava a Etapa 9 (o admin registra o valor em R$ do contrato; decidido em 06/11/2026) | 13 |
| Provedor do WhatsApp e custo por mensagem | 10 |
| Preço da mensalidade | 11 |
| Antecedência do aviso e prazo da renovação | 12 |
| Termo de assinatura das imobiliárias e corretores (o aceite entra no 13.4) | 13 |

---

## Etapa 0 — Protótipo do design

**Pronto quando:** o fluxo inteiro pode ser clicado, do cadastro do imóvel até o "vendido".
**Situação:** o protótipo já existe: **"PAUTA — Protótipo"** no Claude (https://claude.ai/artifact/GBqYuzenozHgGygiGrSS12), com 63 telas (36 de celular e 27 de site) e o roteiro clicável do fluxo inteiro. Falta revisar e completar.

**Telas que já existem**, pelo nome do arquivo (as de site têm o prefixo `Site`):

| Área | Telas |
| --- | --- |
| Entrada | Main (início), Entrar, Cadastro, CadastroImobiliaria, AguardandoAtivacao, Convite |
| Proprietário | ProImoveis, ProNovo, ProFotos, ProTermo, ProEnviado, ProImovel (visitas e propostas), ProAvisos |
| Corretor e imobiliária | CorCatalogo, CorImovel, CorVisita, CorProposta, CorNegociacoes, CorContrato, CorAvisos, ImobEquipe |
| Admin | AdmPainel, AdmAprovar, AdmCaptar, AdmAssinantes, AdmEdicoes, AdmContratos, AdmVendido |

**0.1 Revisar o protótipo**

```text
Leia a docs/visao-geral.md e o protótipo https://claude.ai/artifact/GBqYuzenozHgGygiGrSS12, tela por tela.
Me entregue três listas:
1. Regras e requisitos da Visão geral que não têm tela. Confira em especial: pagamento da mensalidade e assinante com pagamento vencido ou bloqueado (Etapa 11), renovação da exclusividade pelo proprietário (Etapa 12), recuperação de senha, imóvel reprovado com motivo e reenvio, e apagar imóvel pendente
2. Telas que contradizem a Visão geral
3. Textos e títulos que ainda usam o nome antigo, Domora
Não mude nada ainda: me mostre as listas para decidirmos.
```

**0.2 Completar o protótipo**

```text
Das listas, vamos fazer os itens <lista>. Crie as telas que faltam no mesmo estilo das outras (pauta.css e site.css), em celular e site, e ligue-as ao roteiro clicável. Troque Domora por PAUTA em todos os textos e títulos, inclusive no título do protótipo.
```

**0.3 Percorrer o fluxo**

```text
Percorra comigo o fluxo inteiro no protótipo: proprietário cadastra → admin aprova → corretor vê no catálogo → pede visita → proprietário confirma → corretor envia proposta → proprietário aceita → corretor envia contrato → admin aprova → vendido.
No fim, liste tudo o que o protótipo revelou que a Visão geral não diz ou diz diferente. Não mude a Visão geral sozinho: me mostre a lista para decidirmos.
```

---

## Etapa 1 — Setup

**Pronto quando:** a página abre em localhost, conecta ao Supabase novo e o código está no repositório `PAUTA`.
**Antes (à mão):** repositório `PAUTA` vazio no GitHub, projeto Supabase PAUTA (São Paulo) criado, Gabriel convidado.

**1.1 Criar o projeto** *(modo de planejamento)*

```text
Vamos começar a Etapa 1 do PAUTA. O repositório HevelynLV/PAUTA está vazio e eu estou na pasta <caminho>.
Me guie para criar o app Next.js 16 com TypeScript, Tailwind, App Router e código em src/, numa branch etapa-1-setup. Explique cada opção do create-next-app antes de eu responder.
Depois, leia o guia em node_modules/next/dist/docs/ e me resuma o que mudou no Next.js 16 em relação aos tutoriais comuns e que vai afetar o PAUTA (rotas, Server Actions, middleware/proxy, cache).
```

**1.2 Levar a documentação para o repositório**

```text
Traga os documentos do planejamento para o repositório: "PAUTA README" vira README.md, "PAUTA Roadmap" vira ROADMAP.md, "PAUTA - Visão geral da plataforma" vira docs/visao-geral.md, "PAUTA Roadmap de prompts" vira docs/prompts.md, e o CLAUDE.md vai para a raiz. Ajuste os links internos e o README para o que já existe agora. Não mude regras de negócio.
Traga também o protótipo https://claude.ai/artifact/GBqYuzenozHgGygiGrSS12 para docs/prototipo/: todos os arquivos .dc.html, o pauta.css e o site.css (só os arquivos da pasta project/ do protótipo). Assim o Gabriel e as próximas sessões leem as telas sem depender do link. Acrescente ao CLAUDE.md, em "Estrutura importante": "docs/prototipo/: as telas do protótipo; toda tela nova segue o layout da tela correspondente".
```

Se o Claude Code não conseguir abrir o link do protótipo, exporte os arquivos pelo próprio protótipo (Compartilhar › Exportar) e coloque em `docs/prototipo/` à mão.

**1.3 Conectar ao Supabase**

```text
Conecte o app ao Supabase novo: instale as bibliotecas, crie src/lib/supabase/client.ts e src/lib/supabase/server.ts e me diga o que colocar no .env.local (a chave secreta não entra no código do app).
Faça uma página de teste que mostre se a conexão funcionou, sem depender de tabela nenhuma. Confira que o .gitignore ignora .env*.
```

**1.4 Decidir como aplicar as migrations**

```text
Compare aplicar as migrations à mão pelo SQL Editor (como no Captador) com usar o supabase db push, para duas pessoas num banco compartilhado. Considere histórico de migrations, risco de aplicar duas vezes e facilidade para quem está aprendendo. Recomende uma. Depois que eu decidir, registre no README (passo 5), no CLAUDE.md e na Visão geral.
```

**1.5 Comandos do projeto**

```text
Crie os comandos .claude/commands/auditar-etapa.md e .claude/commands/atualizar-roadmap.md com as regras do PAUTA:
- /auditar-etapa <n>: revisa o código da etapa n contra os RFs e RNFs dela na docs/visao-geral.md e contra o CLAUDE.md (exigirTipo em toda página e action, RLS em toda tabela, contato do proprietário, chave secreta fora do navegador, migrations, testes que conferem o que deve ser barrado). Separa os achados por gravidade e NÃO corrige nada
- /atualizar-roadmap: atualiza "Onde paramos", "Atenção", "Pendências", "Migrations aplicadas no banco", as etapas e o Histórico do ROADMAP.md com a data de hoje e o nome de quem está trabalhando
Se o comando antigo do imobilink servir de base, me diga o que aproveitou e o que mudou.
```

**1.6 Testes e design**

```text
Configure o Playwright com um primeiro teste que abre a página inicial, e o script npm run test:e2e.
Depois, leve para o Tailwind as cores, fontes (Bricolage Grotesque e Figtree), raios, espaçamentos e componentes básicos (botão, card, badge de status, menu de baixo do celular) do protótipo: docs/prototipo/pauta.css (celular) e docs/prototipo/site.css (site). Use os mesmos nomes de cor do protótipo, para cada tela poder ser comparada com o original. Monte uma página de amostra com esses componentes para eu comparar com o protótipo.
```

**1.7 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 1
```

**1.8 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md, com a etapa em que devem ser resolvidos.
Depois confira o "Pronto quando" da Etapa 1, item por item, dizendo como verificou cada um. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

Ligar a Vercel ao repositório pode ser feito já aqui, só para ter um endereço de pré-visualização; o deploy de verdade é na Etapa 13.

---

## Etapa 2 — Banco de dados

**Pronto quando:** o `testar_rls.sql` passa e um assinante bloqueado não vê nenhum imóvel.

**2.1 Abrir a etapa e modelar o banco** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 2 (banco de dados) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e a docs/visao-geral.md inteira. Confira se estou na branch etapa-2-banco; se não, me diga como criá-la a partir da main atualizada.
Me proponha o modelo COMPLETO do MVP (perfis, imobiliárias, convites, imóveis, fotos, edições, visitas, propostas, contratos, avisos, assinaturas) num diagrama, com os status de cada tabela e quem pode ler e escrever cada uma.
Nesta etapa vamos criar só as tabelas de contas e de imóvel; visitas, propostas, contratos, avisos e assinaturas entram nas etapas delas. Me confirme se concorda com esse corte.
Pense em especial em:
- on delete entre perfis e imobiliárias, para o admin poder excluir uma imobiliária pendente e liberar o CRECI (RF16)
- como o contato do proprietário fica escondido dos corretores mesmo chamando a API direto (RNF06): RLS não esconde coluna
- como guardar a data de início da exclusividade (vai ser usada na Etapa 12)
- como ninguém consegue virar admin pelo app (RNF03)
Não escreva SQL ainda.
```

**2.2 Perfis**

```text
Crie a primeira migration: tipos (enums), tabela de perfis e as funções auxiliares de RLS (tipo do usuário logado, assinante ativo). Explique cada política de RLS em uma frase: quem lê, quem escreve e por quê.
Crie também o supabase/testes/testar_rls.sql com os testes desta migration. Regras do roteiro, que valem para todas as migrations daqui em diante: cada teste independente, criando e apagando os próprios dados, sem deixar schema ou dado de teste no banco, e testando também o que deve ser BARRADO.
Me diga como aplicar a migration e rodar o roteiro.
```

**2.3 Imobiliárias e convites**

```text
Crie a migration de imobiliárias e convites, com RLS e os testes no testar_rls.sql. Confira que excluir uma imobiliária pendente libera o CRECI.
```

**2.4 Imóveis, fotos e edições**

```text
Crie a migration de imóveis, fotos e registro de edições, com RLS e os testes no testar_rls.sql. O contato do proprietário fica escondido do jeito que combinamos no 2.1.
```

**2.5 Conferir o roteiro**

```text
Confira se o testar_rls.sql cobre estes casos (se não, acrescente):
- assinante pendente ou bloqueado não vê nenhum imóvel
- assinante ativo vê só imóvel aprovado e não vê o contato quando o proprietário não quer mostrar
- proprietário não vê nem edita imóvel de outro proprietário
- ninguém muda o próprio tipo para admin nem o próprio status de assinatura
Depois me lembre de colocar as migrations no "Atenção" e em "Migrations aplicadas no banco" do ROADMAP.md.
```

**2.6 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 2
```

**2.7 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. Correção no banco é sempre migration nova. No fim, rode o testar_rls.sql inteiro.
Depois confira o "Pronto quando" da Etapa 2, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 3 — Login e perfis

**Pronto quando:** cada tipo de usuário só abre a própria área.
**Telas do protótipo:** Main, Entrar, Cadastro, CadastroImobiliaria, AguardandoAtivacao, SiteInicio, SiteEntrar e SiteCadastro, mais o menu de baixo de cada área.

**3.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 3 (login e perfis) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md, os requisitos RF01 a RF04, RNF02, RNF03 e RNF10 na docs/visao-geral.md e as lições do Captador sobre a Etapa 3. Confira se estou na branch etapa-3-login.
As telas desta etapa no protótipo (docs/prototipo/) são: Main, Entrar, Cadastro, CadastroImobiliaria, AguardandoAtivacao, SiteInicio, SiteEntrar e SiteCadastro, mais o menu de baixo de cada área. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, os riscos de segurança e as suas perguntas. Não escreva código ainda.
```

**3.2 Guarda das áreas**

```text
Crie src/lib/auth.ts com a função exigirTipo(). Explique o que ela devolve e o que faz quando o usuário não está logado ou é de outro tipo.
Mostre também a estrutura de pastas das áreas (proprietário, assinante, admin) e onde entra a checagem de sessão do Next.js 16 (confira no guia em node_modules/next/dist/docs/).
```

**3.3 Cadastro**

```text
Faça o cadastro como proprietário ou imobiliária (RF01, RF02): e-mail, senha, nome, telefone com DDD e, para imobiliária, nome e CRECI.
- Aceite telefone digitado com 0 na frente
- Reconheça os erros do Supabase pelo código, não pelo texto
- Depois que o banco copiar nome, telefone e CRECI para o perfil, apague essas chaves do raw_user_meta_data
- Imobiliária entra com assinatura pendente; CRECI repetido dá uma mensagem clara
- Corretor autônomo: confira no CLAUDE.md e na Visão geral como ele se cadastra e me pergunte se não estiver claro
Mensagens todas em português. No fim, escreva o teste Playwright do cadastro (caminho certo e CRECI repetido) e rode npm run test:e2e.
```

**3.4 Login, saída e senha**

```text
Faça login, logout e recuperação de senha por e-mail (RF03), com o redirecionamento para a área certa de cada tipo. Os links de e-mail do fluxo padrão (PKCE) só funcionam no mesmo navegador: me explique as opções, o que fazemos agora e o que fica para a Etapa 13.
Crie também o supabase/scripts/criar_admin.sql (sem e-mail real salvo). No fim, escreva os testes Playwright e rode npm run test:e2e.
```

**3.5 Áreas separadas**

```text
Escreva os testes Playwright das áreas: cada tipo cai na própria área e é barrado nas outras, inclusive digitando o endereço e chamando uma Server Action de outra área. Use usuários @exemplo.com criados e apagados pelo próprio teste. Rode npm run test:e2e.
```

**3.6 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 3
```

**3.7 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e.
Depois confira o "Pronto quando" da Etapa 3, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 4 — Imóvel

**Pronto quando:** imóvel do proprietário, com fotos e termo aceito, aparece como pendente; imóvel captado pelo admin fica vinculado ao dono e entra disponível quando ele aceita o termo.
**Telas do protótipo:** ProImoveis, ProNovo, ProFotos, ProTermo, ProEnviado, AdmPainel, AdmAprovar, AdmCaptar e AdmEdicoes, e as versões Site de cada uma.
**Decidir antes:** nada do termo: a etapa usa um texto provisório do termo de exclusividade, com versão marcada como provisória (decidido em 26/10/2026). Veja as outras pendências da Etapa 4 no ROADMAP.md.

**4.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 4 (imóvel) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md, os requisitos RF07 a RF14, RF17 e RNF11 na docs/visao-geral.md e o que já existe no banco para imóveis. Confira se estou na branch etapa-4-imovel.
As telas desta etapa no protótipo (docs/prototipo/) são: ProImoveis, ProNovo, ProFotos, ProTermo, ProEnviado, AdmPainel, AdmAprovar, AdmCaptar e AdmEdicoes, e as versões Site de cada uma. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, as mudanças no banco, os riscos e as suas perguntas. Não escreva código ainda.
```

**4.2 Cadastro do imóvel**

```text
Faça o cadastro do imóvel pelo proprietário (RF07): título, descrição, tipo, endereço, bairro, preço, quartos, banheiros, vagas, área e o aceite do termo de exclusividade (por enquanto, o texto provisório combinado no 4.1; o final entra antes do piloto). Guarde quando e qual versão do termo foi aceita. O imóvel nasce pendente.
Valide tudo também no servidor, não só no formulário. No fim, teste Playwright e npm run test:e2e.
```

**4.3 Fotos**

```text
Faça o envio de fotos do imóvel com a escolha da ordem (RF09), pensando no celular (fotos grandes, rede móvel). Explique as políticas do bucket no Storage: quem envia, quem vê foto de imóvel pendente e quem vê de imóvel aprovado. Limite tipo e tamanho do arquivo. No fim, teste Playwright.
```

**4.4 Meus imóveis**

```text
Faça a área "Meus imóveis" do proprietário: lista com o status de cada imóvel, apagar só pendente ou reprovado (RF12, apagando as fotos também) e a opção de mostrar ou não o próprio contato aos corretores (RF13). No fim, teste Playwright, incluindo a tentativa de apagar um imóvel aprovado.
```

**4.5 Aprovar e reprovar**

```text
Faça a tela do admin para aprovar ou reprovar imóveis do proprietário (RF14). A aprovação tem que falhar se o imóvel mudou depois que o admin abriu a tela: explique como você vai detectar isso no banco. Reprovar exige um motivo, que o proprietário vê. Ao aprovar, comece a contar a exclusividade. Se precisar de migration, inclua RLS e testes no testar_rls.sql. No fim, teste Playwright.
```

**4.6 Reenviar e editar**

```text
Faça:
- Editar e reenviar imóvel reprovado (RF11): editar não reenvia sozinho, o reenvio é um passo explícito
- Editar imóvel disponível sem nova aprovação (RF10), registrando cada campo alterado, com valor antigo e novo, inclusive fotos (RNF11). Edição feita pelo admin não é registrada
- A tela do admin para revisar essas edições e marcar como revisadas (RF17)
No fim, testes Playwright.
```

**4.7 Captação pelo admin**

```text
Faça o cadastro de imóvel captado pelo admin (RF08): entra direto como disponível e vinculado à conta de proprietário do dono real. Antes de codar, me pergunte: e se o dono ainda não tiver conta no PAUTA? E quem aceita o termo de exclusividade nesse caso?
```

**4.8 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 4
```

**4.9 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e, se mexeu no banco, o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 4, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 5 — Assinantes

**Pronto quando:** o admin ativa imobiliária e autônomo, e o corretor convidado entra já vinculado e ativo.
**Telas do protótipo:** AdmAssinantes, Convite, ImobEquipe e AguardandoAtivacao, e as versões Site.

**5.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 5 (assinantes) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e os requisitos RF05, RF06, RF15 e RF16 na docs/visao-geral.md. Confira se estou na branch etapa-5-assinantes.
As telas desta etapa no protótipo (docs/prototipo/) são: AdmAssinantes, Convite, ImobEquipe e AguardandoAtivacao, e as versões Site. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, as mudanças no banco, os riscos e as suas perguntas. Não escreva código ainda.
```

**5.2 Admin e assinantes**

```text
Faça a área do admin para assinantes: lista de pendentes com o CRECI em destaque (o admin confere à mão), ativar e bloquear (RF15), e excluir imobiliária ou autônomo pendente com o usuário dele, liberando o CRECI (RF16). Bloquear tem efeito na hora, também para os corretores da imobiliária. No fim, teste Playwright.
```

**5.3 Corretor autônomo**

```text
Faça o cadastro do corretor autônomo com o próprio CRECI, assinando sem imobiliária (RF06), seguindo o que ficou decidido na Etapa 3. No fim, teste Playwright.
```

**5.4 Convites**

```text
Faça o convite de corretores pelo responsável da imobiliária, por e-mail ou link (RF05). O corretor cria a conta pelo convite e já entra vinculado e ativo.
Explique antes: como o link é protegido (token, validade, uso único), o que acontece se a imobiliária for bloqueada depois, e como mandamos o e-mail antes de termos SMTP próprio (Etapa 13). No fim, teste Playwright, incluindo convite vencido e convite já usado.
```

**5.5 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 5
```

**5.6 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e, se mexeu no banco, o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 5, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 6 — Catálogo

**Pronto quando:** assinante ativo filtra pelo celular e vê "disponível" ou "em negociação"; bloqueado não vê nada; vendido não aparece.
**Telas do protótipo:** CorCatalogo, CorImovel, SiteCorCatalogo e SiteCorImovel.
**Decidir antes:** quais filtros.

**6.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 6 (catálogo) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e os requisitos RF18 a RF20, RNF06, RNF09 e RNF14 na docs/visao-geral.md. Os filtros decididos são: <lista>. Confira se estou na branch etapa-6-catalogo.
As telas desta etapa no protótipo (docs/prototipo/) são: CorCatalogo, CorImovel, SiteCorCatalogo e SiteCorImovel. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, os riscos e as suas perguntas. Não escreva código ainda.
```

**6.2 Lista e filtros**

```text
Faça o catálogo do assinante (RF18, RF19) com os filtros decididos, pensado primeiro para o celular: cards com a primeira foto, paginação ou rolagem infinita e imagens otimizadas para rede móvel. Os filtros ficam na URL, para o corretor poder compartilhar uma busca. No fim, teste Playwright com tela de celular, incluindo assinante bloqueado.
```

**6.3 Status e detalhe**

```text
Mostre ao corretor só dois status: disponível ou em negociação (RF20). As propostas só existem na Etapa 8: prepare o cálculo do status agora de um jeito que a Etapa 8 só precise ligar.
Faça a página de detalhe do imóvel, com galeria de fotos, endereço e o contato do proprietário só se ele escolheu mostrar. Confira pelo navegador (aba Network) que o contato não vem na resposta quando está escondido. No fim, teste Playwright.
```

**6.4 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 6
```

**6.5 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e, se mexeu no banco, o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 6, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 7 — Visita

**Pronto quando:** o corretor pede visita, o proprietário confirma ou recusa e o corretor vê a resposta.
**Telas do protótipo:** CorVisita, ProImovel (aba Visitas), SiteCorImovel (janela de pedir visita) e SiteProImovel.

**7.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 7 (visita) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e os requisitos RF21, RF22 e RNF07 na docs/visao-geral.md. Confira se estou na branch etapa-7-visita.
As telas desta etapa no protótipo (docs/prototipo/) são: CorVisita, ProImovel (aba Visitas), SiteCorImovel (janela de pedir visita) e SiteProImovel. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, a tabela de visitas com as políticas de RLS, os riscos e as suas perguntas. Me diga também o que acontece com as visitas pendentes se o imóvel for vendido. Não escreva código ainda.
```

**7.2 Banco**

```text
Crie a migration de visitas, com RLS e os testes no testar_rls.sql: outros corretores não veem os pedidos de ninguém, e o proprietário só vê os do próprio imóvel.
```

**7.3 Telas**

```text
Faça o fluxo de visita (RF21, RF22):
- O corretor pede a visita sugerindo data e hora; não aceita horário no passado; horário de Florianópolis
- O proprietário vê o pedido com nome, imobiliária e contato do corretor (RNF07) e confirma ou recusa
- O corretor vê a resposta nos pedidos dele
No fim, teste Playwright do fluxo inteiro.
```

**7.4 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 7
```

**7.5 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 7, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 8 — Proposta

**Pronto quando:** duas propostas aceitas no mesmo imóvel deixam ele "em negociação".
**Telas do protótipo:** CorProposta, CorNegociacoes, ProImovel (aba Propostas), SiteCorImovel (janela de proposta), SiteCorNegociacoes e SiteProImovel.

**8.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 8 (proposta) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e os requisitos RF20, RF23 e RF24 na docs/visao-geral.md. Veja também como a Etapa 6 preparou o status "em negociação". Confira se estou na branch etapa-8-proposta.
As telas desta etapa no protótipo (docs/prototipo/) são: CorProposta, CorNegociacoes, ProImovel (aba Propostas), SiteCorImovel (janela de proposta), SiteCorNegociacoes e SiteProImovel. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, a tabela de propostas com as políticas de RLS, os riscos e as suas perguntas. Não escreva código ainda.
```

**8.2 Banco**

```text
Crie a migration de propostas, com RLS e os testes no testar_rls.sql: o corretor vê só as próprias propostas, e o proprietário só as do próprio imóvel.
```

**8.3 Telas e status**

```text
Faça o fluxo de proposta (RF23, RF24):
- O corretor envia valor e condições
- O proprietário vê os dados do corretor e aceita ou recusa cada proposta; pode ter várias aceitas ao mesmo tempo
- Ligue o status "em negociação" do catálogo: basta uma proposta aceita
No fim, teste Playwright cobrindo o critério da etapa: duas propostas aceitas no mesmo imóvel.
```

**8.4 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 8
```

**8.5 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 8, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 9 — Contrato e venda

**Pronto quando:** aprovar o contrato marca o imóvel como vendido e recusa as outras propostas numa operação só; recusar devolve com motivo.
**Telas do protótipo:** CorContrato, AdmContratos, AdmVendido, AdmPainel (comissões), SiteCorNegociacoes, SiteAdmContratos e SiteAdmVendido.
**Decidir antes:** nada: o admin registra o valor em R$ que está no contrato. A % do PAUTA fica para antes do piloto (decidido em 06/11/2026).

**9.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 9 (contrato e venda) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e os requisitos RF25, RF26, RF32, RNF05 e RNF08 na docs/visao-geral.md. Confira se estou na branch etapa-9-contrato.
As telas desta etapa no protótipo (docs/prototipo/) são: CorContrato, AdmContratos, AdmVendido, AdmPainel (comissões), SiteCorNegociacoes, SiteAdmContratos e SiteAdmVendido. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, as tabelas e o bucket com as políticas de acesso, os riscos e as suas perguntas. Explique por que aprovar o contrato precisa ser uma função no Postgres e não várias chamadas do Next.js. Não escreva código ainda.
```

**9.2 Banco**

```text
Crie a migration de contratos e do registro da comissão, com RLS e os testes no testar_rls.sql. Bucket privado para os PDFs: só o corretor que enviou, o proprietário do imóvel e o admin veem (RNF08).
Crie também a função de aprovação atômica (RNF05): o imóvel vira vendido, sai do catálogo e todas as outras propostas em aberto são recusadas; se algo falhar, nada muda. Teste no roteiro o caso de dois contratos do mesmo imóvel aprovados ao mesmo tempo.
```

**9.3 Envio do contrato**

```text
Faça o envio do contrato assinado em PDF (RF25), só a partir de uma proposta do próprio corretor já aceita, com links temporários para ver o arquivo. Confira tipo e tamanho do arquivo no servidor. No fim, teste Playwright, incluindo a tentativa de enviar sem proposta aceita.
```

**9.4 Conferência pelo admin**

```text
Faça a conferência do contrato pelo admin (RF26, RF32):
- Aprovar usa a função atômica do 9.2 e registra o valor da comissão do PAUTA que consta no contrato; depois, o admin marca se foi paga
- Recusar exige motivo; o corretor pode reenviar e o imóvel segue em negociação
No fim, teste Playwright do fluxo inteiro, do contrato enviado ao vendido.
```

**9.5 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 9
```

**9.6 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 9, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 10 — Avisos

**Pronto quando:** cada evento do fluxo gera aviso na lista do app e no WhatsApp.
**Telas do protótipo:** CorAvisos, ProAvisos, SiteCorAvisos e SiteProAvisos.
**Decidir antes:** provedor do WhatsApp.

**10.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 10 (avisos) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e o requisito RF29 na docs/visao-geral.md. O provedor do WhatsApp decidido é <provedor>. Confira se estou na branch etapa-10-avisos.
As telas desta etapa no protótipo (docs/prototipo/) são: CorAvisos, ProAvisos, SiteCorAvisos e SiteProAvisos. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me entregue o plano em passos pequenos, a tabela de avisos com as políticas de RLS, os riscos e as suas perguntas. Liste todos os eventos que já existem no código e que precisam gerar aviso. Não escreva código ainda.
```

**10.2 Lista de avisos no app**

```text
Crie a migration de avisos (RLS: cada usuário vê só os próprios; testes no testar_rls.sql).
Faça a lista de avisos dentro do app, com contador de não lidos. Crie um ponto único no código que registra um aviso, e chame-o em cada evento: imóvel aprovado ou reprovado, pedido e resposta de visita, proposta e resposta, contrato enviado, aprovado ou recusado, venda. No fim, teste Playwright.
```

**10.3 WhatsApp**

```text
Ligue os avisos ao WhatsApp pelo provedor decidido. Antes de codar, me explique: modelos de mensagem que precisam de aprovação, consentimento do usuário para receber, custo por mensagem e o que acontece se o envio falhar (o aviso no app nunca pode deixar de ser criado por causa do WhatsApp).
As chaves ficam só no .env.local e na Vercel, nunca no navegador. Em desenvolvimento, use o número de teste do provedor. Me lembre de colocar as variáveis novas no "Atenção" do ROADMAP.md e no README.
```

**10.4 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 10
```

**10.5 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 10, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 11 — Cobrança

**Pronto quando:** assinante com pagamento vencido no Asaas perde o acesso sozinho.
**Telas do protótipo:** AguardandoAtivacao (passo do pagamento) e as telas de pagamento criadas no passo 0.2.
**Decidir antes:** preço da mensalidade.

**11.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 11 (cobrança) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e os requisitos RF27 e RF28 na docs/visao-geral.md. A mensalidade decidida é <valor>. Confira se estou na branch etapa-11-cobranca.
As telas desta etapa no protótipo (docs/prototipo/) são: AguardandoAtivacao (passo do pagamento) e as telas de pagamento criadas no passo 0.2. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
Me explique o fluxo antes do plano: quando criamos o cliente e a assinatura no Asaas, o que guardamos no nosso banco e como a imobiliária vê e paga as cobranças. Os corretores convidados não pagam: seguem a assinatura da imobiliária. Depois me entregue o plano em passos pequenos, os riscos e as suas perguntas. Não escreva código ainda.
```

**11.2 Assinatura no Asaas**

```text
Integre o Asaas em ambiente de testes (sandbox) para cobrar a mensalidade (RF27) por boleto, Pix ou cartão. Se precisar de migration, inclua RLS e testes no testar_rls.sql. As chaves ficam só no .env.local; me lembre de colocá-las no "Atenção" do ROADMAP.md e no README.
```

**11.3 Webhook e corte de acesso**

```text
Faça a rota de webhook do Asaas:
- Confere o token do webhook antes de qualquer coisa (não usa exigirTipo)
- É idempotente: o mesmo evento chegando duas vezes não muda nada
- Pagamento confirmado ativa; pagamento vencido bloqueia o acesso sozinho (RF28), e o catálogo já respeita isso
Me diga como testar o webhook no localhost e como simular um pagamento vencido no sandbox.
```

**11.4 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 11
```

**11.5 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e, se mexeu no banco, o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 11, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 12 — Exclusividade

**Pronto quando:** sem renovação, o imóvel sai do catálogo sozinho no vencimento.
**Telas do protótipo:** AdmPainel (exclusividade vencendo), ProImovel (data da exclusividade) e as telas de renovação criadas no passo 0.2.
**Decidir antes:** antecedência do aviso e prazo da renovação.

**12.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 12 (exclusividade) do PAUTA. Leia "Onde paramos" e "Atenção" no ROADMAP.md e os requisitos RF30 e RF31 na docs/visao-geral.md. O aviso sai <n> dias antes, e a renovação é por <prazo>. Confira se estou na branch etapa-12-exclusividade.
As telas desta etapa no protótipo (docs/prototipo/) são: AdmPainel (exclusividade vencendo), ProImovel (data da exclusividade) e as telas de renovação criadas no passo 0.2. Construa seguindo o layout delas, com os componentes do passo 1.6; se o protótipo e a Visão geral divergirem, me pergunte.
O vencimento precisa ser conferido todo dia sem ninguém clicar: compare pg_cron no Supabase com Vercel Cron e recomende um. Me diga também o que acontece com um imóvel em negociação que vence. Depois me entregue o plano em passos pequenos. Não escreva código ainda.
```

**12.2 Aviso, renovação e retirada**

```text
Faça o controle da exclusividade (RF30, RF31):
- Aviso ao proprietário e ao admin antes de vencer, pelos avisos da Etapa 10
- O proprietário renova e o imóvel continua no catálogo
- Sem renovação, o imóvel sai do catálogo sozinho no vencimento
Se precisar de migration, inclua RLS e testes no testar_rls.sql. Me mostre como testar sem esperar 6 meses.
```

**12.3 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 12
```

**12.4 Corrigir e fechar**

```text
Da auditoria, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e, se mexeu no banco, o testar_rls.sql.
Depois confira o "Pronto quando" da Etapa 12, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Etapa 13 — PWA, testes e deploy

**Pronto quando:** o roteiro de teste passa inteiro e o app abre pelo endereço público no celular de outra pessoa.
**Decidir antes:** termo de assinatura das imobiliárias e corretores.

**13.1 Abrir a etapa** *(`/clear` + modo de planejamento)*

```text
Vamos começar a Etapa 13 (PWA, testes e deploy) do PAUTA. Leia "Onde paramos", "Atenção" e "Pendências" no ROADMAP.md, as lições do Captador sobre a Etapa 13 e os requisitos RNF08, RNF09, RNF10 e RNF13 a RNF15 na docs/visao-geral.md. Confira se estou na branch etapa-13-deploy.
Me entregue o plano em passos pequenos, incluindo as pendências das etapas anteriores que precisam ser resolvidas antes do piloto. Não escreva código ainda.
```

**13.2 E-mail**

```text
Configure o SMTP próprio (<Resend ou outro>) no Supabase, com os modelos de e-mail em português (confirmação, recuperação de senha, convite). Me guie para religar a confirmação de e-mail e ligar o "Secure password change". Confira que o cadastro não revela se um e-mail já tem conta, e planeje a limpeza das contas nunca confirmadas.
```

**13.3 PWA**

```text
Transforme o PAUTA em PWA (RNF09): manifesto, ícones (a partir do logo do protótipo), cor do tema (a do protótipo) e instalação na tela inicial do celular, seguindo o guia do Next.js 16. Sem cache offline dos dados por enquanto: explique por quê.
```

**13.4 LGPD e termo de assinatura**

```text
Faça o mínimo de LGPD para o piloto (RNF08): o usuário pede a exclusão ou anonimização dos dados dele. Me diga antes o que acontece com imóveis, propostas e contratos de quem pede exclusão (alguns precisam ser guardados). Inclua o aceite do termo de assinatura no cadastro de imobiliária e autônomo, guardando data e versão.
```

**13.5 Roteiro completo**

```text
Faça o roteiro de teste completo do MVP em Playwright: o fluxo inteiro (do cadastro do imóvel ao vendido), mais assinante bloqueado, assinante vencido e exclusividade vencida. Rode tudo, junto com o testar_rls.sql, e me mostre o que falhou.
```

**13.6 Auditar** *(sessão nova: `/clear`)*

```text
/auditar-etapa 13
```

```text
/security-review
```

**13.7 Corrigir**

```text
Das duas revisões, corrija os itens <lista>; os itens <lista> vão para "Pendências" no ROADMAP.md. No fim, rode npm run test:e2e e o testar_rls.sql.
```

**13.8 Deploy e fechar**

```text
Me guie no deploy na Vercel: variáveis de ambiente (quais vão e quais NUNCA vão, como a chave secreta do Supabase), troca do Site URL e das Redirect URLs do Supabase para o endereço público, webhook do Asaas apontando para produção e Asaas e WhatsApp saindo do modo de teste. Me dê um checklist para conferir no celular de outra pessoa.
Depois confira o "Pronto quando" da Etapa 13, item por item. Se estiver tudo certo, rode /atualizar-roadmap e me passe os comandos de commit e push e o texto do Pull Request.
```

---

## Depois do MVP: piloto

```text
O MVP está no ar. Leia a docs/visao-geral.md (decisões sobre o piloto) e me ajude a montar o checklist do piloto em Florianópolis: quais dados acompanhar para provar que proprietários dão exclusividade, que assinantes pagam e que uma venda fecha de ponta a ponta, e como ver esses números no próprio banco.
```
