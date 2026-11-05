# PAUTA — Visão geral da plataforma

Última revisão: 16/10/2026 · Hevelyn

## Ideia

O PAUTA é um marketplace de imóveis exclusivos: um catálogo de imóveis captados por nós ou cadastrados pelo próprio proprietário, que imobiliárias e corretores autônomos acessam pagando uma mensalidade, para vender.

Como funciona, em seis passos:

1. O **proprietário/admin** cadastra o imóvel com fotos e informações na plataforma, e o proprietário aceita o termo de exclusividade: durante o prazo, o imóvel só é vendido pelo PAUTA. O imóvel captado pelo admin fica vinculado à conta do dono real, que passa a usar o app como qualquer proprietário.
2. O imóvel cadastrado direto pelo proprietário precisa ser validado pelo admin antes de entrar no catálogo.
3. A **imobiliária/corretor** assinante navega no catálogo pelo celular ou pelo site. Qualquer corretor pode trabalhar qualquer imóvel, ao mesmo tempo que outros corretores.
4. O **corretor** pede uma visita pelo app, sugerindo um horário, e o proprietário confirma ou recusa no app.
5. O corretor envia propostas pelo app. O proprietário aceita ou recusa cada uma e pode negociar com vários corretores ao mesmo tempo.
6. O contrato é assinado fora do app (Clicksign ou outro meio), por todas as partes. O corretor envia o contrato assinado, o admin confere e, ao aprovar, o imóvel vira **vendido** e todas as outras propostas em aberto são recusadas automaticamente. O pagamento da venda também acontece fora da plataforma.

O proprietário acompanha tudo pelo app (status, visitas, propostas), com opção de escolher se quer ter seu contato/perfil exposto durante as negociações de seus imóveis.

## Diferencial

O PAUTA reúne num só catálogo imóveis conferidos, captados por nós ou pelos proprietários, e dá ao proprietário controle sobre visitas, propostas e o próprio contato. O peso de cada ponto abaixo ainda precisa ser validado com proprietários e imobiliárias reais.

- **Imóveis exclusivos:** durante o prazo da exclusividade, o imóvel só é vendido pelo PAUTA, e não está anunciado por várias imobiliárias ao mesmo tempo.
- **Curadoria:** todo imóvel passa pela aprovação do admin antes de aparecer, e toda imobiliária tem o CRECI conferido antes de entrar.
- **Privacidade do proprietário:** ele escolhe se mostra o próprio contato; se não mostrar, visitas e propostas passam só pelo app.
- **Transparência para o proprietário:** ele vê em tempo real as visitas e propostas do próprio imóvel.
- **Para a imobiliária e o corretor:** acesso a um estoque que não precisou captar, por uma mensalidade fixa e uma % da comissão só quando a venda fecha.

## Nome do app

O nome usado em toda a documentação é **PAUTA** (antes, Domora e, antes disso, Captador). O repositório novo no GitHub é o `HevelynLV/PAUTA`; o antigo, `imobilink`, fica arquivado para consulta.

## Usuários e perfis

O app tem três tipos de usuário, cada um com a própria área, que os outros não conseguem abrir.

| Perfil | O que faz | Como entra |
| --- | --- | --- |
| Proprietário | Cadastra o imóvel, confirma visitas, aceita ou recusa propostas, escolhe se mostra o contato | Cadastro pelo app, com telefone obrigatório (também o dono de imóvel captado: o admin vincula o imóvel a essa conta) |
| Imobiliária / corretor / corretor autônomo | Assinante: vê o catálogo, pede visitas, envia propostas e envia o contrato assinado | Imobiliária e corretor autônomo: cadastro pelo app com CRECI (e o nome da imobiliária), entram como pendentes até o admin ativar. Corretor de imobiliária: por convite do responsável |
| Admin | Cadastra imóveis captados, aprova ou reprova imóveis, ativa ou bloqueia assinantes, revisa edições, confere contratos | Criado à mão no banco, nunca pelo app |

Uma imobiliária pode ter vários corretores, cada um com login próprio, que entra por convite do responsável e fica vinculado à imobiliária em que trabalha.

## Tecnologias

O PAUTA é um web app responsivo (PWA), feito primeiro para celular e site, sem app nas lojas no MVP.

| Camada | Tecnologia | Para quê | Quando entra |
| --- | --- | --- | --- |
| Interface e servidor | Next.js 16 (App Router), React 19, TypeScript | Telas, Server Actions e rotas | Etapa 1 |
| Estilo | Tailwind CSS 4 | Layout responsivo | Etapa 1 |
| Banco de dados | Supabase (Postgres) com RLS | Dados e regras de acesso direto no banco | Etapas 1 e 2 |
| Login | Supabase Auth | Cadastro, login, recuperação de senha | Etapa 3 |
| Arquivos | Supabase Storage | Fotos dos imóveis e contratos assinados (PDF) | Etapas 4 e 9 |
| Testes | Playwright (ponta a ponta) e roteiro SQL `testar_rls.sql` | Garantir que as regras de acesso não quebram | Desde a Etapa 2 |
| Código e hospedagem | GitHub e Vercel | Versionamento e publicação | GitHub na Etapa 1; Vercel na Etapa 13 |
| E-mail | SMTP próprio (ex.: Resend) | E-mails de confirmação e recuperação em português | Etapa 13, antes do piloto |
| Cobrança | Asaas | Mensalidade dos assinantes | Etapa 11 |
| Avisos | API oficial do WhatsApp Business | Avisos de visita, proposta, contrato e vencimento da exclusividade | Etapa 10 (provedor em aberto) |

Uma regra vale para toda a stack: chaves e senhas ficam no `.env.local`, e a chave secreta do Supabase nunca vai para o navegador.

## Requisitos funcionais

O que o app faz. Todos os 32 estão a construir no repositório novo (RF01 a RF04 já existem no `imobilink` arquivado e servem de referência).

| ID | Módulo | Requisito | Situação |
| --- | --- | --- | --- |
| RF01 | Contas | Cadastro como proprietário, imobiliária ou corretor autônomo, com e-mail, senha, nome e telefone com DDD | A construir |
| RF02 | Contas | Imobiliária informa nome e CRECI (o corretor autônomo, o próprio CRECI); o CRECI não pode repetir; entra com assinatura pendente | A construir |
| RF03 | Contas | Login, logout e recuperação de senha por e-mail | A construir |
| RF04 | Contas | Cada tipo de usuário só abre a própria área, nem digitando o endereço | A construir |
| RF05 | Contas | O responsável pela imobiliária convida corretores por e-mail ou link; o corretor cria a conta pelo convite e já entra vinculado e ativo, sem nova conferência do admin | A construir |
| RF06 | Contas | Corretor autônomo se cadastra com o próprio CRECI e assina sem imobiliária | A construir |
| RF07 | Imóvel | Proprietário cadastra imóvel (título, descrição, tipo, endereço, bairro, preço, quartos, banheiros, vagas, área) e aceita o termo de exclusividade | A construir |
| RF08 | Imóvel | Admin cadastra imóvel captado (dados e fotos) e o vincula à conta que o dono real já criou no app; esse imóvel não passa por validação e entra no catálogo quando o dono aceita o termo de exclusividade | A construir |
| RF09 | Imóvel | Enviar fotos do imóvel e definir a ordem | A construir |
| RF10 | Imóvel | Editar imóvel disponível sem nova aprovação, registrando cada campo alterado para o admin | A construir |
| RF11 | Imóvel | Editar e reenviar imóvel reprovado para aprovação | A construir |
| RF12 | Imóvel | Apagar imóvel pendente de aprovação ou reprovado | A construir |
| RF13 | Imóvel | Proprietário escolhe se mostra o próprio contato aos corretores | A construir |
| RF14 | Admin | Aprovar ou reprovar imóvel cadastrado pelo proprietário; a aprovação falha se o imóvel mudou depois que o admin abriu a tela | A construir |
| RF15 | Admin | Ativar ou bloquear assinante depois de conferir o CRECI à mão | A construir |
| RF16 | Admin | Excluir imobiliária ou corretor autônomo pendente com o usuário dele, liberando o CRECI | A construir |
| RF17 | Admin | Revisar as edições de imóveis disponíveis e marcar como revisadas | A construir |
| RF18 | Catálogo | Só assinantes ativos veem o catálogo, e só imóveis aprovados aparecem | A construir |
| RF19 | Catálogo | Filtrar o catálogo no celular e no site por tipo, bairro (vários ao mesmo tempo), faixa de preço, quartos mínimos e status (decidido em 03/11/2026) | A construir |
| RF20 | Catálogo | O corretor vê no catálogo só dois status: disponível ou em negociação (há proposta aceita). O imóvel continua recebendo visitas e propostas e sai do catálogo assim que o admin aprova o contrato | A construir |
| RF21 | Visita | Corretor pede visita pelo app, sugerindo um horário | A construir |
| RF22 | Visita | Proprietário confirma ou recusa a visita no app, e o corretor vê a resposta | A construir |
| RF23 | Proposta | Corretor envia proposta com valor, forma de pagamento, condições e, se quiser, o nome do comprador | A construir |
| RF24 | Proposta | Proprietário aceita ou recusa cada proposta; pode ter várias aceitas ao mesmo tempo | A construir |
| RF25 | Venda | Corretor envia o contrato assinado por todas as partes (PDF), só a partir de uma proposta dele já aceita pelo proprietário | A construir |
| RF26 | Venda | Admin confere o contrato; ao aprovar, o imóvel vira vendido e todas as outras propostas em aberto são recusadas automaticamente. Ao recusar, escreve o motivo, o corretor é avisado e pode reenviar, e o imóvel segue em negociação com as outras propostas valendo | A construir |
| RF27 | Cobrança | Cobrar a mensalidade do assinante pelo Asaas (boleto, Pix ou cartão), com aviso de pagamento por webhook (preço em aberto) | A construir |
| RF28 | Cobrança | Assinante com pagamento vencido perde o acesso sozinho | A construir |
| RF29 | Avisos | Avisar usuários de eventos (imóvel aprovado, pedido de visita, proposta, contrato, venda, vencimento da exclusividade) por WhatsApp e por uma lista de avisos dentro do app | A construir |
| RF30 | Exclusividade | Proprietário e admin recebem um aviso antes de os 6 meses de exclusividade vencerem (antecedência: a definir) | A construir |
| RF31 | Exclusividade | Proprietário renova a exclusividade e o imóvel continua no catálogo; sem renovação, o imóvel sai do catálogo no vencimento | A construir |
| RF32 | Venda | Ao aprovar o contrato, o admin registra o valor da comissão do PAUTA que consta no contrato e, depois, se ela foi paga | A construir |

## Requisitos não funcionais

Como o app precisa se comportar. Os itens de segurança e privacidade vêm das regras de negócio e valem desde já; os de desempenho e disponibilidade ainda não têm meta numérica.

| ID | Categoria | Requisito |
| --- | --- | --- |
| RNF01 | Segurança | As regras de acesso ficam no banco (RLS), e não só nas telas: quem chama o banco direto também é barrado |
| RNF02 | Segurança | Toda página de área e toda Server Action confere o tipo do usuário no início (`exigirTipo()`) |
| RNF03 | Segurança | Ninguém vira admin pelo app, nem alterando a requisição |
| RNF04 | Segurança | Chaves e senhas só no `.env.local`; a chave secreta do Supabase nunca vai para o navegador |
| RNF05 | Segurança | Aprovar o contrato é uma operação atômica: o imóvel vira vendido e todas as outras propostas em aberto são recusadas juntas, ou nada muda |
| RNF06 | Privacidade | O contato do proprietário só chega a corretores se ele escolher mostrar, nem pela API |
| RNF07 | Privacidade | O proprietário vê os dados do corretor (nome, imobiliária e contato) nas visitas e propostas do próprio imóvel; outros proprietários não veem |
| RNF08 | Privacidade | O contrato enviado só é visto pelo corretor que enviou, pelo proprietário do imóvel e pelo admin. LGPD: o usuário consegue pedir exclusão ou anonimização dos dados (a planejar) |
| RNF09 | Usabilidade | Feito primeiro para celular, e também funciona no site pelo computador; funciona como PWA (instalável na tela inicial) |
| RNF10 | Usabilidade | Todo o app em português, inclusive os e-mails |
| RNF11 | Rastreabilidade | Toda edição de imóvel aprovado fica registrada (campo, valor antigo e novo) para o admin |
| RNF12 | Qualidade | Toda mudança no banco vira migration no repositório, e o roteiro `testar_rls.sql` precisa passar |
| RNF13 | Qualidade | Os testes ponta a ponta (Playwright) passam antes de cada Pull Request ser aceito |
| RNF14 | Desempenho | O catálogo abre rápido no celular em rede móvel: até 3 segundos no Lighthouse, com celular e 4G simulados (decidido em 03/11/2026) |
| RNF15 | Disponibilidade | Hospedagem na Vercel e no Supabase gerenciado, sem servidor próprio (meta de disponibilidade: a definir) |
| RNF16 | Escala | MVP só em Florianópolis (SC); volume esperado de imóveis e imobiliárias no piloto: a definir |

## Fora do escopo do MVP

Ficam para depois do MVP: chat interno, mapa, app nativo nas lojas e outras cidades além de Florianópolis. A assinatura do contrato e o pagamento da venda acontecem fora do app; o app só recebe o contrato já assinado.

## Etapas do MVP

O projeto recomeça do zero num repositório `PAUTA` e num projeto Supabase novos; o `imobilink` fica arquivado para consulta. Antes de programar, um protótipo do design das telas. Cada etapa entrega uma fatia do fluxo funcionando, com banco, tela e teste. O acompanhamento fica no Roadmap.

| Etapa | O que entrega | Pronto quando | Decidir antes |
| --- | --- | --- | --- |
| 0. Protótipo | Telas principais dos três perfis, sem código de verdade | O fluxo inteiro pode ser clicado do cadastro do imóvel até o vendido | — |
| 1. Setup | Repositório `pauta`, Next.js, Supabase novo, Vercel | A página abre em localhost e conecta ao Supabase | — |
| 2. Banco | Tabelas e RLS do modelo novo | `testar_rls.sql` passa: assinante bloqueado não vê nada | — |
| 3. Login e perfis | Cadastro, login, áreas separadas | Cada tipo de usuário só abre a própria área | — |
| 4. Imóvel | Cadastro com fotos e termo; captação pelo admin; aprovar ou reprovar | Imóvel do proprietário fica pendente; o do admin entra disponível quando o dono aceita o termo | — (usa um termo provisório) |
| 5. Assinantes | Ativação pelo admin, convite de corretores, autônomo | Corretor convidado entra vinculado e ativo | — |
| 6. Catálogo | Filtros, status disponível ou em negociação | Assinante ativo filtra no celular; bloqueado não vê nada | — (filtros decididos em 03/11/2026) |
| 7. Visita | Pedido e confirmação | O corretor vê a resposta do proprietário | — |
| 8. Proposta | Envio e aceite, várias ao mesmo tempo | Duas propostas aceitas deixam o imóvel em negociação | — |
| 9. Contrato e venda | Envio, conferência, comissão | Aprovar marca vendido e recusa as outras numa operação só | % do PAUTA |
| 10. Avisos | Lista no app e WhatsApp | Cada evento gera aviso nos dois canais | Provedor do WhatsApp |
| 11. Cobrança | Asaas em ambiente de testes | Assinante vencido perde o acesso sozinho | Preço da mensalidade |
| 12. Exclusividade | Aviso de vencimento e renovação | Sem renovação, o imóvel sai do catálogo sozinho | Antecedência do aviso |
| 13. PWA, testes e deploy | SMTP, PWA, roteiro completo, Vercel | O app abre no celular de outra pessoa pelo endereço público | Texto final dos dois termos |

## Decisões tomadas em 05/11/2026 (plano da Etapa 8)

- Campos da proposta: valor, forma de pagamento (à vista, financiamento ou permuta), condições e nome do comprador. Na tela, vale o rótulo da decisão, não o do protótipo: "À vista", "Financiamento" e "Permuta".
- O nome do comprador é opcional. É dado pessoal de outra pessoa: só o corretor que enviou, o proprietário do imóvel e o admin veem, e ele entra no plano de exclusão e anonimização da LGPD (passo 13.4).
- "Em negociação" é calculado direto das propostas aceitas, e a coluna `imoveis.tem_proposta_aceita` sai do banco: assim aceitar, desfazer, recusar em massa e excluir conta não têm como deixar o status errado. O cálculo fica numa função só, usada também no selo do proprietário. Resolve a pendência da auditoria da Etapa 2.
- Depois de recusada, o corretor pode mandar outra proposta, sem limite, porque o comprador sempre pode querer acrescentar algo à negociação. O limite vale só para proposta em aberto: uma por corretor em cada imóvel. O excesso de avisos fica para ser revisto na Etapa 10.
- O corretor pode retirar a própria proposta, aguardando ou aceita, enquanto o contrato dela não foi enviado. Depois disso, pode mandar outra. Retirar evita o imóvel preso em negociação e é o caminho para melhorar uma proposta ainda em aberto.
- Desfazer o aceite devolve a proposta para "aguardando": o proprietário ainda pode aceitar ou recusar.
- Quando o responsável remove um corretor, as propostas em aberto dele são canceladas, como as visitas. A imobiliária continua a negociação mandando outra proposta por outro corretor.
- Corretor bloqueado ou vencido: as propostas não mudam, porque o bloqueio é temporário, e o proprietário continua podendo responder. O corretor volta a vê-las quando recuperar o acesso.
- O proprietário pode editar imóvel em negociação pela regra do imóvel disponível: vale na hora e fica registrado. A proposta guarda o valor enviado.
- O proprietário responde às propostas na aba Propostas da página do imóvel, como no protótipo, sem aba geral em Meus imóveis. A lista mostra "N propostas" e o selo "Em negociação".

## Decisões tomadas em 05/11/2026 (auditoria da Etapa 7)

- O banco recusa pedido de visita a mais de 15 dias ou fora do minuto cheio. Os 14 dias e a lista de horários continuam sendo regra de tela: o teto do banco existe para ninguém pular a tela pela API, com horário infinito, muito distante ou um segundo depois de um horário confirmado. Segue sem limite de pedidos por hora.
- Cancelar uma visita guarda quando e quem cancelou, para os avisos da Etapa 10.
- No celular, "Agendar visita" fica no rodapé fixo da página do imóvel, como no protótipo.

## Decisões tomadas em 04/11/2026 (plano da Etapa 7)

- Na página do imóvel, o corretor agenda a visita num calendário: próximos 14 dias, horários fixos do protótipo (09:00, 10:00, 11:00, 14:00, 15:30 e 17:00), recado opcional de até 500 caracteres. Os horários valem na tela; o banco exige horário futuro, de minuto cheio e a até 15 dias (auditoria da Etapa 7, 05/11/2026), então a lista pode mudar sem migration.
- Só a visita confirmada fecha o horário. Horário fechado aparece riscado para todos os corretores, sem mostrar quem marcou: outro corretor continua sem ver os pedidos de ninguém.
- Vários corretores podem pedir o mesmo horário enquanto ninguém foi confirmado, e o proprietário escolhe um. Ao confirmar, os outros pedidos daquele imóvel e horário são recusados na mesma operação, e cada corretor vê a recusa.
- Um corretor pode ter várias visitas no mesmo imóvel, sem limite, desde que em horários diferentes.
- O proprietário só confirma ou recusa, sem escrever motivo nem sugerir outro horário: um texto dele abriria um caminho para passar o contato escondido.
- O proprietário vê também o CRECI do corretor, além de nome, imobiliária e contato.
- O corretor cancela a própria visita pendente ou confirmada, e o proprietário cancela a confirmada. Cancelar uma visita confirmada reabre o horário; os pedidos já recusados não voltam.
- Em Meus imóveis, o proprietário tem uma aba Visitas com a agenda de todos os seus imóveis e a lista das próximas visitas: no computador, a semana com dias e horários; no celular, uma faixa com os dias e a lista do dia escolhido. Ele confirma e recusa ali. A página de cada imóvel mostra só as visitas daquele imóvel, com a mesma peça. Essa tela não existe no protótipo.
- O corretor acompanha as visitas em Negociações, na aba Visitas; a aba Propostas entra na Etapa 8.
- Quando o responsável remove um corretor, as visitas em aberto dele são canceladas. Para corretor bloqueado ou vencido, a visita continua visível ao proprietário e a regra completa fica para a Etapa 11.
- Pedido pendente cujo horário passou não pode mais ser confirmado e aparece como "Horário passou", sem tarefa automática.

## Decisões tomadas em 03/11/2026 (plano da Etapa 6)

- O assinante não lê mais a tabela de imóveis direto: o catálogo e o detalhe vêm de funções do banco que devolvem só as colunas do corretor (sem `proprietario_id`, `exclusividade_fim`, `termo_versao`, `captado_pelo_admin` nem `versao`). As fotos continuam visíveis para ele por uma função auxiliar. Resolve a pendência da auditoria da Etapa 2.
- "Disponível" ou "em negociação" é decidido num lugar só no banco; a Etapa 8 só troca esse cálculo.
- O campo "Buscar por bairro ou título" do protótipo sai, porque não está nos filtros decididos. No lugar, um campo "procurar bairro" dentro da lista de bairros (56 nomes).
- Os botões "Pedir visita" e "Enviar proposta" ficam escondidos até as Etapas 7 e 8; o espaço deles fica preparado no layout.
- Paginação: páginas de 12 imóveis, com "Anterior" e "Próxima" e o número da página na URL.
- Quando o proprietário mostra o contato, o corretor vê o telefone com botão de ligar, um botão de WhatsApp e o e-mail.
- Na URL, tipo e bairro vão pelo número (ex.: `bairro=12`), para um link salvo não quebrar se um nome mudar.
- Ordem fixa da lista: o imóvel que entrou no catálogo mais recentemente aparece primeiro.
- Meta do RNF14: o catálogo abre em até 3 segundos no Lighthouse, com celular e 4G simulados. A medição de verdade é no endereço público, na Etapa 13.
- Textos: "Contato do proprietário não divulgado" (neutro; o protótipo dizia "da proprietária"). No topo da lista, o nome da imobiliária (ou o do corretor autônomo), como no protótipo.

## Decisões tomadas em 03/11/2026 (filtros do catálogo)

- O catálogo tem cinco filtros, no celular e no site: tipo, bairro, faixa de preço (mínimo e máximo), quartos mínimos (1+ a 4+) e status (disponível ou em negociação). É a sugestão do protótipo (SiteCorCatalogo), escolhida porque usa só colunas que o imóvel já tem e porque, com poucos imóveis no piloto, filtros demais deixariam a lista vazia à toa.
- No bairro, o corretor marca vários ao mesmo tempo (ex.: Campeche, Rio Tavares e Morro das Pedras), porque costuma trabalhar uma região, não um bairro só.
- Com quartos mínimos escolhido, imóvel sem quartos (terreno, sala comercial) sai da lista.
- Os filtros ficam na URL, para o corretor compartilhar uma busca.
- Ficam fora do MVP: vagas, área, banheiros e escolha da ordenação. Entram depois do piloto, se os corretores pedirem.

## Decisões tomadas em 28/10/2026 (plano da Etapa 5)

Substituem, sobre o CRECI, a decisão de 22/10/2026 (plano da Etapa 3), marcada abaixo.

- O cadastro pede o número do CRECI **com a letra**: J (pessoa jurídica, o CRECI da empresa) ou F (pessoa física, o CRECI do corretor). CRECI sem letra é recusado, na tela e no banco. Assim `12345` e `12345-J` não entram como dois CRECIs diferentes.
- Imobiliária só se cadastra com CRECI J. Corretor autônomo pode usar J ou F (o autônomo que abriu empresa tem CRECI J). O corretor convidado não informa CRECI: vale o da imobiliária.
- Na comparação de CRECI repetido, pontos, traços e espaços continuam não contando ("12.345-J" e "12345J" são o mesmo CRECI). O admin continua conferindo o CRECI à mão antes de ativar.
- O responsável pela imobiliária remove corretores da equipe na tela Equipe. O corretor removido perde o acesso ao catálogo na hora; a conta dele não é apagada (ele vê a tela de acesso suspenso) e continua ligada à imobiliária só como histórico. O responsável não remove a si mesmo. A Visão geral e o protótipo não tinham essa ação: sem ela, quem sai da imobiliária continuaria vendo o catálogo.
- O corretor removido que for para outra imobiliária entra por um convite novo com **outra conta, de outro e-mail**. A conta antiga continua presa à imobiliária anterior, guardando o histórico dela.
- Convite por e-mail sem envio automático até a Etapa 13: o responsável digita o e-mail do corretor, o PAUTA cria o convite preso a esse e-mail e mostra o link para o responsável mandar (WhatsApp ou o e-mail dele). Só esse e-mail consegue usar o convite. Quando o SMTP próprio entrar (passo 13.2), o PAUTA passa a mandar o e-mail sozinho, com o mesmo link. O `inviteUserByEmail` do Supabase não é usado (ele cria a conta antes de o corretor informar nome e telefone), então o convite não usa a chave secreta.
- Convite por link, sem e-mail ("Copiar link"): cada clique gera um link novo, que vale para uma pessoa só e vence como os outros convites. Ele aparece na lista da equipe como convite por link aguardando, e o responsável pode cancelar. Não existe link fixo da imobiliária que sirva para várias pessoas.
- O admin exclui também o corretor autônomo pendente, com o usuário dele, liberando o CRECI (RF16 ampliado): o risco de alguém travar o CRECI de outra pessoa é o mesmo da imobiliária. Assinante ativo, vencido ou bloqueado continua sem poder ser excluído.
- O convite (por e-mail ou por link) vale 7 dias. Vencido, o responsável gera outro.
- (passo 5.4) O código do convite é sorteado pelo banco, que guarda só uma versão embaralhada dele: o link aparece uma vez só, logo depois de criado. Se o responsável perder o link, cancela o convite e cria outro.
- (passo 5.4) Convite por e-mail para um e-mail que já tem conta no PAUTA é recusado com a mensagem "Este e-mail já tem conta no PAUTA". Isso revela a uma imobiliária ativa que aquele e-mail tem conta; o risco foi aceito, porque só imobiliária conferida pelo admin consegue perguntar.
- (passo 5.4) Um novo convite para um e-mail que já tem convite aguardando substitui o anterior: só o link novo vale.
- (passo 5.4) Os corretores removidos continuam na tela Equipe, no fim da lista, com o selo "Removido" e a data, sem botão.
- (passo 5.6, auditoria) Cada imobiliária cria no máximo **20 convites por hora**, contando também as tentativas para e-mail que já tem conta. Assim a mensagem "Este e-mail já tem conta" não serve para testar e-mails em série.
- (passo 5.6, auditoria) Com a confirmação de e-mail desligada (até o passo 13.2), quem recebe um convite por e-mail repassado consegue criar a conta digitando o e-mail do convidado: ainda não há como provar que a pessoa é dona do e-mail. Fica para o 13.2: com a confirmação ligada, o convite só é gasto e o corretor só ganha acesso depois de confirmar o e-mail.

## Decisões tomadas em 27/10/2026 (passo 4.7, captação)

Substituem as decisões de 22/10/2026 sobre o imóvel captado (marcadas abaixo).

- O dono de imóvel captado precisa ter conta no PAUTA, criada por ele mesmo pelo app (cadastro de proprietário). O admin não cria conta de ninguém: na captação, ele procura a conta do dono e vincula o imóvel a ela. Se o dono ainda não tem conta, a equipe pede que ele se cadastre antes.
- O admin cadastra os dados e as fotos do imóvel captado. O imóvel fica fora do catálogo ("aguardando o aceite do dono") até o dono ler e aceitar o termo de exclusividade daquele imóvel no app (como no cadastro feito pelo proprietário, o aceite é por imóvel, com data e versão guardadas). O aceite exige pelo menos uma foto. Enquanto espera, o admin muda as fotos ou apaga o imóvel; o dono só aceita.
- Os 6 meses de exclusividade do imóvel captado contam do aceite do dono, quando ele entra no catálogo.

## Decisões tomadas em 26/10/2026 (plano da Etapa 4)

- O cadastro do imóvel segue a ordem do protótipo (dados, fotos, termo). Para isso existe o status `rascunho`: o passo 1 cria o imóvel em rascunho, o passo 2 envia as fotos e o aceite do termo no passo 3 o passa para pendente. O rascunho só o dono vê, edita e apaga; ele não entra na fila do admin.
- O proprietário edita o imóvel pendente de aprovação (dados, fotos e a escolha de mostrar o contato). Essa edição não vai para o registro de edições, porque o imóvel ainda não está no catálogo; a versão do imóvel sobe, e a aprovação feita numa tela aberta antes da edição falha.
- A escolha de mostrar o contato fica numa página do imóvel do proprietário, criada já na Etapa 4 sem as abas de visitas e propostas (que entram nas Etapas 7 e 8).
- Tipos de imóvel: casa, apartamento, cobertura, terreno e sala comercial. Bairros: os 56 bairros oficiais de Florianópolis do Decreto municipal nº 29.142 (abril de 2026), tirados da lista por região publicada sobre o decreto; falta conferir contra o texto do próprio decreto (ver Pendências da Etapa 4 no ROADMAP).
- Fotos do imóvel: JPG, PNG ou WebP, até 10 MB cada, reduzidas no navegador antes do envio; no mínimo 1 para enviar para aprovação e no máximo 20 por imóvel.
- O termo de exclusividade fica numa tabela de versões no banco; o imóvel guarda qual versão foi aceita, e só a versão vigente pode ser aceita. O texto final (Etapa 13) entra como uma versão nova.

## Decisões tomadas em 26/10/2026

- Os textos do termo de exclusividade e do termo de assinatura ficam para depois e não travam a Etapa 4. A Etapa 4 constrói o aceite com um texto provisório, com uma versão marcada como provisória e guardada no aceite (data e versão), como num termo de verdade. Quando o texto final estiver pronto, ele entra no projeto como uma versão nova, antes do piloto (Etapa 13). Aceites da versão provisória valem só para teste: nenhum proprietário real aceita o termo provisório.

## Decisões tomadas em 22/10/2026 (plano da Etapa 3)

- O login fica sempre conectado até a pessoa sair: não existe a opção "manter conectado" (o app é usado principalmente no celular).
- O cadastro pede só o número do CRECI (**mudado em 28/10/2026**: agora com a letra J ou F obrigatória, ver acima). A UF é sempre SC, porque o piloto é só em Florianópolis. Na comparação de CRECI repetido, pontos, traços e espaços não contam ("12.345-J" e "12345J" são o mesmo CRECI).
- O link do e-mail de recuperação de senha funciona em qualquer navegador (modelo do e-mail com `token_hash` no painel do Supabase, trocado na Etapa 3), não só no navegador em que foi pedido.
- O aceite do termo de assinatura entra no cadastro de imobiliária e autônomo só no passo 13.4, quando o texto do termo existir. Até lá, o cadastro não mostra a caixa de aceite.

## Decisões tomadas em 22/10/2026

Decididas antes do passo 2.1, porque mudam tabelas ou status do banco.

**Contas e assinatura**
- A assinatura tem três status: pendente, ativo e vencido (pagamento atrasado no Asaas). O bloqueio é decisão do admin e fica à parte do status (coluna `bloqueado_pelo_admin`, desde a auditoria da Etapa 2), para o admin não tirar ninguém do vencido sem pagamento. Bloqueado e vencido perdem o acesso. Desbloquear não libera quem está vencido: só o pagamento libera.
- O corretor convidado segue a assinatura da imobiliária: se a imobiliária for bloqueada ou vencer, os corretores dela perdem o acesso na hora.
- O corretor autônomo se cadastra pela tela pública, com o próprio CRECI, e entra pendente até o admin ativar, como a imobiliária. O cadastro pelo app passa a ser como proprietário, imobiliária ou corretor autônomo.
- As ações do admin que mexem no login das pessoas (excluir a imobiliária pendente com o usuário dela; **mudado em 28/10/2026**: o convite não usa mais a chave secreta) usam uma chave secreta de produção, separada das chaves pessoais de teste, só no servidor (`src/lib/supabase/admin.ts`, com `server-only`, sem `NEXT_PUBLIC_`). Ela só é usada depois de conferir que quem pede é admin.

**Imóvel**
- Os 6 meses de exclusividade começam a contar na aprovação do admin. ~~Imóvel captado pelo admin começa a contar no cadastro, porque já entra disponível.~~ (Substituída em 27/10/2026: o captado conta do aceite do dono.)
- A escolha de mostrar o contato aos corretores vale para cada imóvel, não para a conta toda. O contato mostrado é o telefone e o e-mail da conta do proprietário.
- Tipos de imóvel e bairros de Florianópolis ficam em listas fixas no banco, que só o admin altera.
- ~~Imóvel captado cujo dono ainda não tem conta: o admin cria a conta do dono (nome, e-mail e telefone), o dono recebe um e-mail para criar a senha e aceita o termo de exclusividade no app, no primeiro acesso, com data e versão guardadas. O imóvel já entra disponível.~~ (Substituída em 27/10/2026: o dono cria a própria conta e o captado só entra no catálogo depois do aceite.)

**Visita e proposta**
- A visita não é obrigatória antes da proposta.
- Cada corretor tem no máximo uma proposta em aberto (aguardando resposta ou aceita) por imóvel. Depois de recusada ou retirada, pode mandar outra.
- O proprietário pode desfazer o aceite de uma proposta enquanto o corretor não enviou o contrato dela; o corretor é avisado e a proposta volta a aguardar resposta. Com contrato enviado, não pode mais.

**Contrato e venda**
- Se o valor final do contrato for diferente do da proposta, vale o do contrato: o admin registra o valor final ao aprovar, e a proposta fica guardada como estava.
- Ao aprovar o contrato, na mesma operação: o imóvel vira vendido, todas as outras propostas em aberto (aceitas e ainda sem resposta) são recusadas e as visitas pendentes ou marcadas são canceladas. Os corretores envolvidos são avisados.

## Decisões tomadas em 20/10/2026

- As migrations do banco são aplicadas pelo terminal com a Supabase CLI (`npx supabase db push`), e não à mão pelo SQL Editor. A CLI registra no banco quais migrations já rodaram, o que evita aplicar duas vezes ou esquecer uma com duas pessoas no mesmo banco. O passo a passo está no README (passo 5).
- O Cache Components do Next.js 16 fica ligado, como o Next 16.4 cria o projeto. O Next vai torná-lo obrigatório na próxima versão grande.
- Fotos e PDFs são enviados do navegador direto para o Supabase Storage, com permissão dada pelo servidor, porque as Server Actions aceitam no máximo 1 MB por padrão.
- O repositório se chama `HevelynLV/PAUTA` (o pacote npm continua `pauta`, em minúsculas).

## Decisões tomadas em 16/10/2026

- O nome do app passa a ser **PAUTA** (antes, Domora). O repositório novo no GitHub se chama `PAUTA` (`HevelynLV/PAUTA`).

## Decisões tomadas na revisão de 13/10/2026

- O nome do app é Domora (substituído por **PAUTA** em 16/10/2026).
- Todo imóvel é exclusivo do PAUTA por 6 meses, e o proprietário não tira o imóvel de venda nesse período. Antes do vencimento, proprietário e admin recebem um aviso: se o proprietário renovar, o imóvel continua no catálogo; se não, sai. Não há reserva: qualquer corretor assinante trabalha qualquer imóvel, ao mesmo tempo que outros.
- Corretor autônomo pode assinar, além das imobiliárias.
- O PAUTA também capta imóveis: o admin cadastra e vincula o imóvel à conta do dono real, que usa o app como qualquer proprietário.
- O proprietário escolhe se mostra o próprio contato aos corretores. Ele sempre vê nome, imobiliária e contato dos corretores que pedem visita ou mandam proposta no imóvel dele.
- A visita é sempre marcada pelo app: o corretor sugere o horário e o proprietário confirma ou recusa.
- O proprietário aceita ou recusa cada proposta e pode negociar com vários corretores ao mesmo tempo.
- O contrato é assinado fora do app (Clicksign ou outro meio), por todas as partes. O corretor envia o PDF a partir de uma proposta aceita, o admin confere e, ao aprovar, o imóvel vira vendido e as outras propostas em aberto são recusadas. Se o admin recusar o contrato, escreve o motivo e o corretor pode reenviar; o imóvel segue em negociação.
- O pagamento da venda acontece fora da plataforma.
- No catálogo, o corretor vê o imóvel só como disponível ou em negociação. Depois que o admin aprova o contrato, o imóvel sai do catálogo.
- Os avisos saem por WhatsApp e numa lista de avisos dentro do app.
- O corretor entra na imobiliária por convite do responsável (e-mail ou link) e já fica vinculado e ativo. Basta o CRECI da imobiliária: ela responde pelos seus corretores, o que fica no termo de assinatura.
- Receita: mensalidade dos assinantes mais uma % da comissão de cada venda fechada. A % vem escrita no contrato de compra e venda e é paga fora do app; o app só registra. A mensalidade é cobrada pelo Asaas.
- O piloto acontece em Florianópolis (SC) e precisa provar três coisas ao mesmo tempo, em pequena escala: proprietários dão exclusividade, assinantes pagam e uma venda fecha de ponta a ponta. Poucos imóveis captados pelo admin e poucas imobiliárias convidadas, com tudo funcionando de forma simples.

## Decisões em aberto

Estes pontos travam requisitos acima e precisam de resposta antes de virar código.

**Negócio**

- [ ] Comissão do PAUTA: qual % (da comissão do corretor ou do valor do imóvel)
- [ ] Preço da mensalidade (igual para imobiliária e corretor autônomo?)

**Fluxo da venda**

- [ ] Exclusividade: com quanto tempo de antecedência sai o aviso de vencimento, e a renovação é por mais 6 meses?
- [ ] WhatsApp: qual provedor da API oficial (Meta direto ou um intermediário como Twilio ou Z-API) e o custo por mensagem

**Termos** (não travam a Etapa 4, que usa um texto provisório; o texto final entra antes do piloto, na Etapa 13. Decidido em 26/10/2026)

- [ ] Texto do termo de exclusividade que o proprietário aceita no cadastro
- [ ] Termo de assinatura do corretor e da imobiliária, com a cláusula contra desintermediação e a responsabilidade da imobiliária pelos corretores que ela convida. O risco aumenta quando o proprietário mostra o contato
