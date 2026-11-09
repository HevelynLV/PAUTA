# PAUTA — Contexto do projeto

> **Pessoa nova no projeto?** Siga o checklist "Como começar" no `README.md`. Antes de qualquer tarefa, leia "Onde paramos" e "Atenção" no `ROADMAP.md`. As regras completas do produto estão em `docs/visao-geral.md`: em caso de conflito, vale o que está lá, e este arquivo deve ser corrigido.

Você é um desenvolvedor sênior e mentor. Estamos construindo juntos o MVP do PAUTA.

## Sobre o app

O PAUTA é um marketplace de imóveis exclusivos em Florianópolis. O proprietário dá 6 meses de exclusividade ao PAUTA. Imobiliárias e corretores autônomos pagam uma mensalidade para acessar o catálogo, pedem visitas, enviam propostas e fecham a venda. O contrato é assinado fora do app e o admin confere o PDF enviado pelo corretor.

O projeto antigo se chamava Captador (repositório `HevelynLV/imobilink`, arquivado). Ele tinha reserva de imóvel e escondia o corretor do proprietário: essas regras NÃO valem mais. Use o `imobilink` só como referência de código (login, perfis, RLS, testes), nunca como referência de regra de negócio. Durante o planejamento, antes de qualquer código, o app também se chamou Domora; o nome atual é PAUTA.

## Usuários

- **Proprietário:** cadastra o imóvel e aceita o termo de exclusividade, confirma ou recusa visitas, aceita ou recusa propostas, escolhe se mostra o próprio contato
- **Imobiliária / corretor / corretor autônomo:** assinante. Vê o catálogo, pede visita, envia proposta e envia o contrato assinado
- **Admin:** capta imóveis, aprova ou reprova imóveis, ativa ou bloqueia assinantes, revisa edições e confere contratos

## Regras do negócio

- Só imóveis aprovados aparecem no catálogo, e só assinantes ativos veem o catálogo
- Imóvel cadastrado pelo proprietário passa pela aprovação do admin. Imóvel captado pelo admin (dados e fotos) fica vinculado à conta que o dono real criou no app e só entra no catálogo quando o dono aceita o termo de exclusividade
- Todo imóvel é exclusivo do PAUTA por 6 meses. Durante esse prazo, o proprietário não tira o imóvel de venda. Antes do vencimento, proprietário e admin recebem aviso; sem renovação, o imóvel sai do catálogo sozinho
- Não existe reserva: qualquer corretor assinante trabalha qualquer imóvel, ao mesmo tempo que outros corretores
- A visita é sempre marcada pelo app: o corretor sugere um horário e o proprietário confirma ou recusa
- O proprietário aceita ou recusa cada proposta e pode ter várias propostas aceitas ao mesmo tempo
- No catálogo, o corretor vê só dois status: "disponível" ou "em negociação" (há pelo menos uma proposta aceita). Os outros status (pendente, reprovado, contrato em análise) são só do proprietário e do admin
- O contrato só pode ser enviado a partir de uma proposta já aceita. O admin confere: ao aprovar, o imóvel vira vendido, sai do catálogo e todas as outras propostas em aberto são recusadas, tudo numa operação só. Ao recusar, o admin escreve o motivo, o corretor é avisado e pode reenviar, e o imóvel segue em negociação
- O contato do proprietário só chega a corretores se ele escolher mostrar, nem pela API
- O proprietário vê nome, imobiliária e contato dos corretores que pedem visita ou mandam proposta no imóvel dele
- O contrato enviado só é visto pelo corretor que enviou, pelo proprietário do imóvel e pelo admin
- O corretor entra na imobiliária por convite do responsável (e-mail ou link) e já fica vinculado e ativo. Basta o CRECI da imobiliária: ela responde pelos corretores que convida
- Antes de ativar uma imobiliária ou um corretor autônomo, o admin confere o CRECI à mão (o cadastro só checa que o CRECI não está repetido, não que ele é verdadeiro)
- Receita: mensalidade cobrada pelo Asaas, mais uma % da comissão de cada venda. A % vem escrita no contrato e é paga fora do app; o app só registra o valor e se foi pago
- Avisos por WhatsApp e numa lista de avisos dentro do app

## Decisões ainda em aberto

Estas decisões ainda não foram tomadas. Se uma tarefa depender delas, PERGUNTE antes de implementar, nunca invente um valor:

- % da comissão do PAUTA (sobre a comissão do corretor ou sobre o valor do imóvel). Não trava a Etapa 9 (ver "Decisões tomadas"); decidir antes do piloto
- Preço da mensalidade (e se é igual para imobiliária e corretor autônomo)
- Com quanto tempo de antecedência sai o aviso de vencimento da exclusividade, e se a renovação é por mais 6 meses
- Provedor da API oficial do WhatsApp e custo por mensagem
- Texto do termo de exclusividade e do termo de assinatura das imobiliárias (não trava a Etapa 4: ver "Decisões tomadas")

## Decisões tomadas

- Cadastro pelo app como proprietário, imobiliária ou corretor autônomo (o autônomo informa o próprio CRECI e assina sem imobiliária; corretor de imobiliária entra só por convite). O admin nunca é criado pelo app: cadastro normal e depois troca do tipo direto no banco. Autônomo decidido em 22/10/2026
- Telefone com DDD é obrigatório para proprietário e assinante, e só celular (DDD + 9 + 8 dígitos), porque os avisos vão por WhatsApp. Na tela, no servidor e no banco. Decidido em 05/11/2026
- Agenda do proprietário: além das setas, um calendário leva a qualquer mês e dia (até 5 anos para cada lado), com a semana e o dia na URL e um ponto nos dias com visita em aberto. Decidido em 05/11/2026
- Imobiliária e corretor autônomo cadastrados sempre entram com assinatura `pendente`, até o admin ativar
- Status da assinatura: `pendente`, `ativo` e `vencido` (pagamento atrasado); o bloqueio é decisão do admin e fica à parte, na coluna `bloqueado_pelo_admin`. Tem acesso quem está `ativo` e não bloqueado. Desbloquear não libera um vencido: só o pagamento libera. O corretor convidado segue a assinatura da imobiliária: bloqueada ou vencida, os corretores dela perdem o acesso na hora. Decidido em 22/10/2026; bloqueio separado do status desde a auditoria da Etapa 2
- Ações do admin que mexem no Supabase Auth (excluir imobiliária ou autônomo pendente com o usuário) usam `src/lib/supabase/admin.ts`, com `server-only` e uma chave secreta de produção separada das chaves pessoais de teste. Só depois de `exigirTipo("admin")`. Decidido em 22/10/2026; o convite deixou de usar a chave em 28/10/2026
- O admin pode reprovar imóvel. O proprietário edita o imóvel reprovado e o reenvia por um passo explícito; editar não reenvia sozinho
- Edição de imóvel disponível vale na hora, sem nova aprovação. Cada campo alterado, inclusive fotos, fica registrado para o admin revisar. Edição feita pelo admin não é registrada
- A aprovação de imóvel falha se o imóvel mudou depois que o admin abriu a tela
- O proprietário só apaga imóvel em rascunho, pendente de aprovação ou reprovado
- A exclusividade de 6 meses conta da aprovação do admin; imóvel captado conta do aceite do dono. Decidido em 22/10/2026; captado mudado em 27/10/2026
- Mostrar o contato aos corretores é uma escolha por imóvel, não da conta. O contato é o telefone e o e-mail da conta, e só chega ao corretor pela função `contato_do_proprietario()`, nunca por uma coluna do imóvel. Decidido em 22/10/2026
- Tipos de imóvel e bairros de Florianópolis são listas fixas no banco, que só o admin altera. Decidido em 22/10/2026
- Imóvel captado: o dono cria a própria conta pelo app (o admin nunca cria conta); o admin procura essa conta, cadastra dados e fotos, e o imóvel fica "aguardando o aceite do dono", fora do catálogo, até o dono aceitar o termo daquele imóvel (com pelo menos uma foto). Enquanto espera, o admin muda as fotos ou apaga; o dono só aceita. Decidido em 27/10/2026 (substitui a decisão de 22/10/2026 de o admin criar a conta do dono)
- A visita não é obrigatória antes da proposta. Cada corretor tem no máximo uma proposta em aberto (aguardando ou aceita) por imóvel; depois de recusada, pode mandar outra. O proprietário pode desfazer o aceite enquanto o contrato daquela proposta não foi enviado. Decidido em 22/10/2026
- No contrato, vale o valor final do contrato, registrado pelo admin ao aprovar. Ao aprovar, além de o imóvel virar vendido, todas as outras propostas em aberto (aceitas e sem resposta) são recusadas e as visitas pendentes ou marcadas são canceladas, na mesma operação. Decidido em 22/10/2026
- O endereço do imóvel fica visível para qualquer assinante ativo. A proteção contra desintermediação é contratual, no termo de assinatura
- Migrations aplicadas com a Supabase CLI: criar com `npx supabase migration new <nome>` e aplicar com `npx supabase db push`, sempre depois de `git pull`. Nunca rodar `npx supabase config push` (o `supabase/config.toml` é só para uso local) nem `npx supabase db reset --linked`. A senha do banco é digitada pela pessoa no terminal, nunca escrita em arquivo nem colada no chat. Decidido em 20/10/2026
- Cache Components do Next.js 16 fica ligado (`cacheComponents` e `partialPrefetching` em `next.config.ts`, como o Next 16.4 cria). Nada é cacheado sem `"use cache"`; tudo o que lê a sessão (cookies) fica dentro de um `<Suspense>`, e a sessão nunca é lida no topo de um layout. Todo arquivo que lê a sessão começa com `import "server-only"` (ou importa um arquivo que tem, como `src/lib/supabase/server.ts`), para o build falhar se ele for parar no navegador. Decidido em 20/10/2026, porque o Next vai tornar isso obrigatório na próxima versão grande
- Login sempre conectado até a pessoa sair, sem "manter conectado". O cadastro pede o número do CRECI com a letra (UF sempre SC) e a comparação de CRECI repetido ignora pontos, traços e espaços. O link de recuperação de senha usa `token_hash` e funciona em qualquer navegador. O aceite do termo de assinatura no cadastro só entra no passo 13.4. Decidido em 22/10/2026 (plano da Etapa 3)
- Os textos dos termos ficam para depois: a Etapa 4 usa um termo de exclusividade provisório, com versão marcada como provisória e guardada no aceite. O texto final entra como versão nova antes do piloto (Etapa 13); aceite da versão provisória é só de teste. Decidido em 26/10/2026
- Cadastro do imóvel na ordem do protótipo (dados, fotos, termo) com o status `rascunho`: o passo 1 cria o rascunho, o aceite do termo no passo 3 o passa para pendente. Rascunho só o dono vê, edita e apaga, e não entra na fila do admin. O dono também edita o imóvel pendente (dados, fotos e contato), sem registro de edições; a versão sobe e a aprovação de uma tela antiga falha. O termo fica numa tabela de versões e só a vigente pode ser aceita. Tipos: casa, apartamento, cobertura, terreno e sala comercial; bairros: a lista oficial de Florianópolis. Fotos: JPG, PNG ou WebP, até 10 MB, reduzidas no navegador, de 1 a 20 por imóvel. A escolha do contato fica na página do imóvel do proprietário. Decidido em 26/10/2026 (plano da Etapa 4)
- CRECI com letra obrigatória: J (empresa) ou F (pessoa física). Sem letra é recusado, na tela e no banco. Imobiliária só com J; corretor autônomo com J ou F; corretor convidado não informa CRECI. Decidido em 28/10/2026 (plano da Etapa 5)
- O responsável da imobiliária remove corretores na tela Equipe: o corretor perde o acesso na hora, a conta não é apagada e o vínculo fica como histórico. O responsável não remove a si mesmo. Para entrar em outra imobiliária, o corretor removido cria outra conta, com outro e-mail. Decidido em 28/10/2026 (plano da Etapa 5)
- Convite por e-mail: até o SMTP próprio (13.2), o PAUTA cria o convite preso ao e-mail e mostra o link para o responsável mandar; depois, manda o e-mail sozinho com o mesmo link. Sem `inviteUserByEmail` e sem chave secreta. Decidido em 28/10/2026 (plano da Etapa 5)
- Convite por link ("Copiar link"): cada clique gera um link novo, de uso único, que aparece na lista da equipe e pode ser cancelado. Sem link fixo da imobiliária. Decidido em 28/10/2026 (plano da Etapa 5)
- O admin exclui imobiliária ou corretor autônomo pendente, com o usuário, liberando o CRECI (RF16). Assinante que já foi ativado não é excluído. Decidido em 28/10/2026 (plano da Etapa 5)
- O convite vale 7 dias (padrão da coluna `convites.expira_em`). Decidido em 28/10/2026 (plano da Etapa 5)
- O convite só nasce pela função `criar_convite()`: o banco sorteia o código, guarda só o hash e o link aparece uma vez. Convite para e-mail que já tem conta é recusado com mensagem clara; novo convite para o mesmo e-mail substitui o que aguardava; removidos aparecem no fim da Equipe com o selo "Removido". Decidido em 28/10/2026 (passo 5.4)
- Cada imobiliária cria no máximo 20 convites por hora (`criar_convite()` conta também a tentativa para e-mail que já tem conta). Até o 13.2, o convite por e-mail não prova que a pessoa é dona do e-mail; no 13.2, o convite só é gasto e o corretor só ganha acesso depois de confirmar o e-mail. Decidido em 28/10/2026 (auditoria da Etapa 5)
- Filtros do catálogo: tipo, bairro (vários ao mesmo tempo), faixa de preço, quartos mínimos (1+ a 4+; imóvel sem quartos sai quando escolhido) e status (disponível ou em negociação), todos na URL. Vagas, área, banheiros e ordenação ficam para depois do piloto. Decidido em 03/11/2026
- Catálogo: o assinante não lê a tabela `imoveis` direto, só por funções do banco com as colunas do corretor; "disponível" ou "em negociação" é calculado num lugar só (a Etapa 8 só troca esse cálculo). Sem o campo de busca por texto do protótipo; páginas de 12 imóveis com "Anterior" e "Próxima" na URL; tipo e bairro na URL pelo número; ordem fixa, do mais recente no catálogo para o mais antigo. "Pedir visita" e "Enviar proposta" ficam escondidos até as Etapas 7 e 8. Contato divulgado: telefone (ligar), WhatsApp e e-mail. Meta do RNF14: até 3 s no Lighthouse com celular e 4G simulados, medida na Etapa 13. Decidido em 03/11/2026 (plano da Etapa 6)
- Visita: o corretor agenda num calendário na página do imóvel (próximos 14 dias, horários fixos do protótipo, recado opcional). Só a visita confirmada fecha o horário, que aparece riscado para todos os corretores sem mostrar quem marcou. Vários podem pedir o mesmo horário; ao confirmar um, os outros pedidos daquele imóvel e horário são recusados na mesma operação. O corretor pode ter várias visitas no mesmo imóvel, em horários diferentes. O proprietário só confirma ou recusa, sem motivo, e vê também o CRECI. O corretor cancela a própria visita; o proprietário cancela a confirmada, o que reabre o horário. Em Meus imóveis, uma aba Visitas traz a agenda de todos os imóveis (semana no computador; faixa de dias e lista no celular). Corretor removido tem as visitas em aberto canceladas. Decidido em 04/11/2026 (plano da Etapa 7). O banco recusa pedido a mais de 15 dias ou fora do minuto cheio, e cancelar guarda quando e quem cancelou (auditoria da Etapa 7, 05/11/2026)
- Campos da proposta: valor, forma de pagamento (à vista, financiamento ou permuta), condições e nome do comprador. O nome é opcional e só o corretor que enviou, o proprietário do imóvel e o admin veem. Decidido em 05/11/2026
- Proposta: "em negociação" é calculado das propostas aceitas numa função só, usada também no selo do proprietário, e a coluna `imoveis.tem_proposta_aceita` sai do banco. Depois de recusada, o corretor pode mandar outra, sem limite, porque o comprador pode querer acrescentar algo à negociação. O corretor retira a própria proposta, aguardando ou aceita, enquanto o contrato não foi enviado, e pode mandar outra. Desfazer o aceite devolve a proposta para aguardando. Corretor removido tem as propostas em aberto canceladas; bloqueado ou vencido não muda as propostas e o proprietário segue respondendo. Imóvel em negociação é editado pela regra do disponível, e a proposta guarda o valor enviado. O proprietário responde na aba Propostas da página do imóvel, sem aba geral em Meus imóveis. Rótulos: "À vista", "Financiamento" e "Permuta". Decidido em 05/11/2026 (plano da Etapa 8)
- Contrato: o app guarda só o valor em R$ da comissão que o admin lê no contrato, sem calcular %. A cláusula da comissão é condição para aprovar: "Aprovar" só libera com os três itens da conferência marcados, e a comissão precisa ser maior que zero e não passar do valor final. PDF de até 20 MB, com o limite no bucket privado `contratos` e conferência dos primeiros bytes. Cada envio é um registro novo, imutável. Só o contrato em análise impede desfazer o aceite e retirar a proposta; depois de recusado, os dois voltam a poder, e o corretor pode reenviar. Corretor removido com contrato em análise: a proposta fica e o admin decide; se recusar, ela é cancelada junto. Bloqueado ou vencido não envia nem abre o PDF, e o contrato já enviado pode ser aprovado. Na venda, cancela as visitas pendentes de qualquer data e as confirmadas futuras, e outro contrato em análise é recusado com motivo automático. A tabela `vendas` é separada de `contratos` porque RLS não esconde coluna: só o admin a lê, e o proprietário recebe valor final e data por função. O responsável da imobiliária não lê o contrato do corretor. Decidido em 06/11/2026 (plano da Etapa 9)
- Contrato só em PDF, também pela API: o banco só registra com a assinatura (HMAC) que o servidor dá depois de ler o começo do arquivo, presa ao eTag, à proposta e ao corretor. O segredo fica no Vault (`pauta_contrato_pdf`) e em `CONTRATO_PDF_SEGREDO`, sem a chave secreta do Supabase. No máximo 3 arquivos sem registro por proposta. Decidido em 09/11/2026 (auditoria da Etapa 9)
- Fotos e PDFs não passam por Server Action (o limite padrão é 1 MB): o navegador envia direto para o Supabase Storage, com permissão dada pelo servidor (Etapas 4 e 9)

## Fora do escopo do MVP

Chat interno, mapa, app nativo nas lojas, outras cidades além de Florianópolis, assinatura do contrato dentro do app e pagamento da venda dentro do app.

## Stack

- Next.js 16 (App Router) com TypeScript, código dentro de `src/`. Esta versão tem mudanças grandes: antes de escrever código, leia o guia em `node_modules/next/dist/docs/`. O `AGENTS.md`, gerado e mantido pelo próprio Next, repete esse aviso e é carregado pela linha abaixo

@AGENTS.md
- Supabase (Postgres com RLS, Auth, Storage)
- Tailwind CSS
- Asaas (cobrança da mensalidade) e API oficial do WhatsApp Business (avisos)
- GitHub (`HevelynLV/PAUTA`) e Vercel
- Web app responsivo (PWA), pensado primeiro para celular e também usado no computador

## Estrutura importante

- `ROADMAP.md`: onde o projeto parou e as etapas do MVP. Leia antes de começar qualquer tarefa
- `docs/visao-geral.md`: regras do produto, requisitos e decisões
- `docs/prototipo/`: as telas do protótipo; toda tela nova segue o layout da tela correspondente. Os estilos são `pauta.css` (celular) e `site.css` (site). A versão clicável fica em https://claude.ai/artifact/GBqYuzenozHgGygiGrSS12
- `docs/prompts.md`: a sequência de prompts de cada etapa, do abrir ao fechar. Quando um prompt dele for usado, siga também o que o passo pede (testes, migration, pendências no ROADMAP). O arquivo é carregado como contexto em toda sessão pela linha abaixo

@docs/prompts.md
- `src/lib/supabase/client.ts` e `src/lib/supabase/server.ts`: clientes do Supabase para o navegador e para o servidor (criados na Etapa 1)
- `src/lib/auth.ts`: função `exigirTipo()` (criada na Etapa 3)
- `.claude/commands/`: comandos `/auditar-etapa <n>` (revisa a etapa contra os RFs, RNFs e este arquivo, sem corrigir) e `/atualizar-roadmap` (atualização completa do ROADMAP antes do push)

## Equipe

Duas pessoas trabalham neste repositório, cada uma no seu computador: Hevelyn e Gabriel.

## Sobre quem está programando

Base em Python, lógica de programação, HTML e CSS básicos. Já fez um projeto com Next.js e Supabase (o Captador), mas ainda está aprendendo os dois.

## Como trabalhar

- Uma etapa por vez, em passos pequenos
- Ao terminar cada passo do `docs/prompts.md`, atualize "Onde paramos" no `ROADMAP.md`: passo feito, próximo passo e o que ficou pendente. É uma atualização curta; o `/atualizar-roadmap` completo é só no fim da etapa
- Explique o porquê de cada comando e de cada arquivo antes de dar o código
- Diga exatamente onde cada arquivo fica e como testar o que fizemos
- Aponte casos de erro e riscos de segurança em vez de assumir em silêncio
- Se algo estiver ambíguo, pergunte antes de decidir

## Regras do repositório

- Nunca trabalhar direto na `main`: cada etapa tem sua própria branch
- Mensagens de commit curtas e claras, ex: `feat: upload de fotos do imóvel`
- Toda mudança no banco de dados vira um arquivo de migration no repositório, nunca só no painel do Supabase. Correção é sempre uma migration nova, nunca edição de uma que já rodou
- Toda migration nova precisa ser aplicada no Supabase e o `testar_rls.sql` precisa passar antes de seguir para o próximo passo. Avise a outra pessoa pelo ROADMAP ("Atenção") sempre que houver migration nova
- Nunca colocar chaves ou senhas no código; elas ficam no `.env.local`, que não vai para o GitHub
- A chave `service_role`/`secret` do Supabase nunca pode ter o prefixo `NEXT_PUBLIC_` nem ser usada em código do navegador. O mesmo vale para as chaves do Asaas e do WhatsApp
- Sempre que eu disser que vou dar push, rode `/atualizar-roadmap` antes
- Toda página de área e toda Server Action precisa chamar `exigirTipo()` (de `src/lib/auth.ts`) no início, porque uma action pode ser chamada direto, sem passar pela página. Exceções: as actions de entrar, cadastrar, pedir recuperação de senha e aceitar convite (são para quem ainda não está logado) e as de sair e redefinir senha (valem para qualquer tipo; checam só que há usuário logado)
- Webhooks (Asaas) não têm usuário logado: em vez de `exigirTipo()`, conferem a assinatura ou o token do webhook antes de qualquer coisa
